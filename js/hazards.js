// Road alerts on our own map (replaces the Waze tab).
//  - Live Florida DOT / FL511 incidents (crashes, closures, disabled vehicles,
//    debris, construction, congestion) from FDOT's public ArcGIS service.
//  - National Weather Service warnings for your exact location.
//  - Speed and red-light cameras from OpenStreetMap.
// Police-type events (when a feed reports them) trigger a red/blue edge strobe.
import { bus, settings, distance, bearing, angleDiff, fetchJSON } from './util.js';

const FDOT = 'https://gis.fdot.gov/arcgis/rest/services/DIVAS_GetEvent/FeatureServer/0/query';
const FL = { s: 24.3, n: 31.1, w: -87.7, e: -79.8 };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const MILE = 1609.344;

export const KINDS = {
  police:   { icon: '🚓', label: 'Police',           color: '#3b82ff', flash: 'police',  reach: 1.0,  cone: 55, prio: 6, voice: true },
  crash:    { icon: '💥', label: 'Crash',            color: '#ff4d5e', flash: 'danger',  reach: 1.0,  cone: 40, prio: 5, voice: true },
  closure:  { icon: '⛔', label: 'Road closed',      color: '#ff4d5e', flash: 'danger',  reach: 1.0,  cone: 40, prio: 5, voice: true },
  weather:  { icon: '⛈️', label: 'Weather warning',  color: '#7cf7d4', flash: 'weather', reach: 0,    cone: 360, prio: 4, voice: true },
  hazard:   { icon: '⚠️', label: 'Hazard',           color: '#ffb547', flash: 'hazard',  reach: 0.6,  cone: 40, prio: 4, voice: true },
  disabled: { icon: '🚗', label: 'Disabled vehicle', color: '#ffb547', flash: 'hazard',  reach: 0.5,  cone: 35, prio: 3, voice: true },
  camera:   { icon: '📷', label: 'Camera',           color: '#c38bff', flash: null,      reach: 0.3,  cone: 30, prio: 3, voice: true },
  work:     { icon: '🚧', label: 'Road work',        color: '#ff9f40', flash: null,      reach: 0.5,  cone: 35, prio: 2, voice: true },
  traffic:  { icon: '🐢', label: 'Heavy traffic',    color: '#ffcf5a', flash: null,      reach: 1.0,  cone: 30, prio: 1, voice: false },
};

function match(t) {
  if (/police|law enforcement|trooper|\bfhp\b|sheriff|emergency (vehicle|personnel)|officer/.test(t)) return 'police';
  if (/crash|collision|accident|overturn|rollover|jackknif/.test(t)) return 'crash';
  if (/road closed|closure of all|all lanes (blocked|closed)|roadway closed|full closure/.test(t)) return 'closure';
  if (/disabled|stall|broken.?down|abandoned vehicle/.test(t)) return 'disabled';
  if (/construction|maintenance|lane closure|work zone|paving|bridge work|road ?work|utility work/.test(t)) return 'work';
  if (/congestion|traffic|delay|slow|queue|backup/.test(t)) return 'traffic';
  if (/debris|flood|water on|fire|smoke|fog|animal|spill|pothole|object|wrong.?way|sinkhole|hazard|downed|signal (out|malfunction)|blocked/.test(t)) return 'hazard';
  return null;
}

// The event type decides first; the free-text description only breaks ties,
// so "Scheduled Road Work … right lane blocked" stays road work.
export function classify(type, typeDetail, description) {
  return match(`${type || ''} ${typeDetail || ''}`.toLowerCase()) || match((description || '').toLowerCase()) || 'hazard';
}

const cleanDesc = (s) => (s || '').replace(/\s*Last updated at .*$/i, '').trim();

export class Hazards {
  constructor() {
    this.events = [];
    this.cameras = [];
    this.weather = [];
    this.announced = new Map();
    this.lastFdot = null;
    this.lastCam = null;
    this.lastWx = 0;
    this.fix = null;
    this.active = null;
    this.status = { fdot: 'waiting', weather: 'waiting', cameras: 'waiting' };
  }

  get all() {
    const types = settings.get().alertTypes || {};
    return [...this.events, ...this.cameras].filter((h) => types[h.kind] !== false);
  }

  onFix(fix) {
    this.fix = fix;
    this.maybeFdot(fix);
    this.maybeCameras(fix);
    this.maybeWeather(fix);
    this.check(fix);
  }

  // ---------- FL511 via FDOT ----------
  async maybeFdot(fix) {
    const inFL = fix.lat > FL.s && fix.lat < FL.n && fix.lon > FL.w && fix.lon < FL.e;
    if (!inFL) {
      this.status.fdot = 'outside Florida';
      return;
    }
    const l = this.lastFdot;
    if (this.fdotBusy || (l && Date.now() - l.t < 90000 && distance(l.lat, l.lon, fix.lat, fix.lon) < 15000)) return;
    this.fdotBusy = true;
    this.lastFdot = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    const env = [fix.lon - 0.9, fix.lat - 0.75, fix.lon + 0.9, fix.lat + 0.75].map((x) => x.toFixed(3)).join(',');
    const fields = 'id,descriptionen,eventtypedesc,eventtypesae,severity,affectedlanes,highway,direction,crossstreet,county,reportedat,datalastupdatedat,latitude,longitude';
    const url = `${FDOT}?where=1%3D1&geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=false&f=json`;
    try {
      const j = await fetchJSON(url, { timeout: 20000 });
      if (j.error) throw new Error(j.error.message);
      this.events = (j.features || [])
        .map(({ attributes: a }) => {
          if (a.latitude == null || a.longitude == null) return null;
          const kind = classify(a.eventtypedesc, a.eventtypesae, a.descriptionen);
          const lanes = (a.affectedlanes || '').trim();
          return {
            id: `fl${a.id}`, kind, lat: a.latitude, lon: a.longitude, source: 'FL511',
            title: a.eventtypedesc || KINDS[kind].label,
            desc: cleanDesc(a.descriptionen),
            road: [a.highway, a.direction ? a.direction.toUpperCase() : ''].filter(Boolean).join(' '),
            lanes: lanes && lanes !== ' ' ? lanes : '',
            severity: a.severity,
            reported: Date.parse(a.reportedat) || null,
            updated: Date.parse(a.datalastupdatedat) || null,
          };
        })
        .filter(Boolean);
      this.status.fdot = `${this.events.length} nearby · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      this.publish();
    } catch (e) {
      this.status.fdot = `error: ${e.message}`;
      this.lastFdot.t = Date.now() - 60000; // retry in ~30 s
      bus.emit('net-error', { source: 'FL511', message: e.message });
    } finally {
      this.fdotBusy = false;
    }
  }

  // ---------- Cameras (OpenStreetMap) ----------
  async maybeCameras(fix) {
    const l = this.lastCam;
    if (this.camBusy || (l && (distance(l.lat, l.lon, fix.lat, fix.lon) < 8000 || Date.now() - l.t < 60000))) return;
    this.camBusy = true;
    this.lastCam = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    const a = `around:15000,${fix.lat},${fix.lon}`;
    const q = `[out:json][timeout:20];(node["highway"="speed_camera"](${a});node["enforcement"~"maxspeed|traffic_signals|average_speed"](${a});relation["enforcement"~"maxspeed|traffic_signals|average_speed"](${a}););out center;`;
    for (const url of OVERPASS) {
      try {
        const j = await fetchJSON(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000 });
        this.cameras = (j.elements || [])
          .map((e) => {
            const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
            if (lat == null) return null;
            const red = e.tags?.enforcement === 'traffic_signals';
            return { id: `cam${e.id}`, kind: 'camera', lat, lon, source: 'OpenStreetMap', title: red ? 'Red-light camera' : 'Speed camera', desc: red ? 'Red-light enforcement camera' : 'Speed enforcement camera', road: '' };
          })
          .filter(Boolean);
        this.status.cameras = `${this.cameras.length} within 15 km`;
        this.publish();
        break;
      } catch {}
    }
    this.camBusy = false;
  }

  // ---------- National Weather Service ----------
  async maybeWeather(fix) {
    if (Date.now() - this.lastWx < 5 * 60000 || this.wxBusy) return;
    this.wxBusy = true;
    this.lastWx = Date.now();
    try {
      const j = await fetchJSON(`https://api.weather.gov/alerts/active?point=${fix.lat.toFixed(4)},${fix.lon.toFixed(4)}`, { headers: { Accept: 'application/geo+json' } });
      this.weather = (j.features || [])
        .map((f) => f.properties)
        .filter((p) => ['Extreme', 'Severe', 'Moderate'].includes(p.severity))
        .map((p) => ({ id: `nws${p.id}`, kind: 'weather', source: 'National Weather Service', title: p.event, desc: p.headline || '', severity: p.severity, ends: Date.parse(p.ends || p.expires) || null, instruction: p.instruction || '' }));
      this.status.weather = this.weather.length ? `${this.weather.length} active` : 'none active';
      bus.emit('weather-alerts', this.weather);
      for (const w of this.weather) this.announce(w, null);
    } catch (e) {
      this.status.weather = 'unavailable here';
    } finally {
      this.wxBusy = false;
    }
  }

  publish() {
    bus.emit('hazards', this.all);
  }

  // Inject events (tests / future feeds)
  ingest(list) {
    this.events = [...this.events.filter((e) => !list.some((x) => x.id === e.id)), ...list];
    this.publish();
    if (this.fix) this.check(this.fix);
  }

  // ---------- proximity ----------
  check(fix) {
    const s = settings.get();
    const miles = s.alertMiles ?? 2;
    let best = null;
    for (const h of this.all) {
      const k = KINDS[h.kind];
      const d = distance(fix.lat, fix.lon, h.lat, h.lon);
      const radius = Math.max(250, k.reach * miles * MILE);
      if (d > radius) continue;
      const brg = bearing(fix.lat, fix.lon, h.lat, h.lon);
      const moving = fix.speed > 2 && fix.heading != null;
      const ahead = !moving || d < 300 || Math.abs(angleDiff(fix.heading, brg)) < k.cone;
      if (!ahead) continue;
      if (!best || k.prio > KINDS[best.h.kind].prio || (k.prio === KINDS[best.h.kind].prio && d < best.d)) best = { h, d, brg };
    }
    const prev = this.active;
    this.active = best;
    if (best) {
      this.announce(best.h, best.d);
      bus.emit('hazard-active', best);
    } else if (prev) {
      bus.emit('hazard-active', null);
    }
  }

  announce(h, d) {
    const now = Date.now();
    if (now - (this.announced.get(h.id) || 0) < 20 * 60000) return;
    this.announced.set(h.id, now);
    bus.emit('hazard-alert', { h, d });
  }
}
