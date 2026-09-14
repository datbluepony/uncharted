// Road alerts.
//  1. Waze Live Map: Waze's official embeddable live map (police, crashes,
//     hazards, closures, traffic in real time), no key needed.
//  2. Enforcement cameras from OpenStreetMap (Overpass), spoken as you approach.
//  3. Optional: an alert feed URL (Waze georss-format JSON via your own proxy).
import { bus, settings, distance, bearing, angleDiff, fetchJSON, fmtDist } from './util.js';
import { speech } from './speech.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const FEED_TYPES = {
  POLICE: { icon: '🚓', label: 'Police', cls: 'police' },
  ACCIDENT: { icon: '💥', label: 'Crash', cls: '' },
  HAZARD: { icon: '⚠️', label: 'Hazard', cls: 'hazard' },
  ROAD_CLOSED: { icon: '⛔', label: 'Road closed', cls: '' },
  JAM: { icon: '🚗', label: 'Traffic jam', cls: 'hazard' },
};

export class Alerts {
  constructor() {
    this.frame = document.getElementById('wazeFrame');
    this.panel = document.getElementById('wazePanel');
    this.frameCenter = null;
    this.cameras = [];
    this.feed = [];
    this.lastCamFetch = null;
    this.lastFeedFetch = 0;
    this.announced = new Map(); // id -> time
    this.fix = null;
    this.bannerTimer = null;
    document.getElementById('wazeRecenter').onclick = () => this.fix && this.loadFrame(this.fix, true);
  }

  get open() {
    return !this.panel.classList.contains('hidden');
  }

  toggle(force) {
    const show = force ?? !this.open;
    this.panel.classList.toggle('hidden', !show);
    if (show && this.fix) this.loadFrame(this.fix);
    return show;
  }

  loadFrame(fix, force = false) {
    const c = this.frameCenter;
    // Reloading the iframe resets the view, so only recenter after real movement.
    if (!force && c && distance(c.lat, c.lon, fix.lat, fix.lon) < 4000) return;
    this.frameCenter = { lat: fix.lat, lon: fix.lon };
    const zoom = fix.speed > 20 ? 12 : 14;
    this.frame.src = `https://embed.waze.com/iframe?zoom=${zoom}&lat=${fix.lat.toFixed(5)}&lon=${fix.lon.toFixed(5)}&ct=livemap`;
  }

  onFix(fix) {
    this.fix = fix;
    if (this.open) this.loadFrame(fix);
    this.maybeFetchCameras(fix);
    this.maybeFetchFeed(fix);
    this.checkAhead(fix);
  }

  async maybeFetchCameras(fix) {
    const lc = this.lastCamFetch;
    if (lc && (distance(lc.lat, lc.lon, fix.lat, fix.lon) < 8000 || Date.now() - lc.t < 60000)) return;
    this.lastCamFetch = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    const q = `[out:json][timeout:20];(node["highway"="speed_camera"](around:15000,${fix.lat},${fix.lon});node["enforcement"~"maxspeed|traffic_signals|average_speed"](around:15000,${fix.lat},${fix.lon});relation["enforcement"~"maxspeed|traffic_signals|average_speed"](around:15000,${fix.lat},${fix.lon}););out center;`;
    for (const url of OVERPASS) {
      try {
        const j = await fetchJSON(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000 });
        this.cameras = (j.elements || [])
          .map((e) => {
            const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
            if (lat == null) return null;
            const red = e.tags?.enforcement === 'traffic_signals';
            return { id: `cam${e.id}`, lat, lon, icon: '📷', cls: 'hazard', label: red ? 'Red light camera' : 'Speed camera', radius: 700, cone: 35 };
          })
          .filter(Boolean);
        this.publish();
        return;
      } catch {}
    }
  }

  async maybeFetchFeed(fix) {
    const url = settings.get().wazeFeedUrl?.trim();
    if (!url || Date.now() - this.lastFeedFetch < 60000) return;
    this.lastFeedFetch = Date.now();
    const d = 0.12;
    const qs = `top=${fix.lat + d}&bottom=${fix.lat - d}&left=${fix.lon - d}&right=${fix.lon + d}&env=na&types=alerts`;
    try {
      const j = await fetchJSON(url + (url.includes('?') ? '&' : '?') + qs);
      this.feed = (j.alerts || [])
        .map((a) => {
          const t = FEED_TYPES[a.type];
          if (!t || !a.location) return null;
          return { id: a.uuid, lat: a.location.y, lon: a.location.x, ...t, street: a.street, radius: 1600, cone: 30 };
        })
        .filter(Boolean);
      this.publish();
      bus.emit('feed-status', { ok: true, count: this.feed.length });
    } catch (e) {
      bus.emit('feed-status', { ok: false, message: e.message });
    }
  }

  publish() {
    bus.emit('alerts', [...this.cameras, ...this.feed]);
  }

  checkAhead(fix) {
    if (fix.speed < 4 || fix.heading == null) return;
    const now = Date.now();
    for (const a of [...this.feed, ...this.cameras]) {
      const d = distance(fix.lat, fix.lon, a.lat, a.lon);
      if (d > a.radius) continue;
      if (Math.abs(angleDiff(fix.heading, bearing(fix.lat, fix.lon, a.lat, a.lon))) > a.cone) continue;
      if (now - (this.announced.get(a.id) || 0) < 10 * 60000) continue;
      this.announced.set(a.id, now);
      const text = `${a.label} ahead${a.street ? ' on ' + a.street : ''}, ${fmtDist(d)}`;
      this.banner(a, text);
      speech.say(text, { priority: true, kind: 'alert' });
      bus.emit('alert-ahead', a);
      break;
    }
  }

  banner(a, text) {
    const el = document.getElementById('alert');
    el.className = a.cls || '';
    document.getElementById('alertIcon').textContent = a.icon;
    document.getElementById('alertText').textContent = text;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), 8000);
  }
}
