// Everything a web page can learn about the car without any Tesla API:
//  - Tesla browser + software version (user agent)
//  - onboard computer hints (CPU threads, GPU renderer → MCU generation, display)
//  - connectivity (Network Information API + a latency probe)
//  - elevation (GPS altitude, else Open-Meteo)
//  - estimated energy use from a physics model of a 2022–2023 Model 3
//  - nearest Superchargers (supercharge.info open dataset)
import { bus, idb, distance, fetchJSON, settings } from './util.js';

// ---------------- Detection ----------------
export function detectCar() {
  const ua = navigator.userAgent;
  const m = ua.match(/Tesla\/([\w.]+?)(?:-([0-9a-f]{6,}))?(?:\s|$)/i);
  const chromium = (ua.match(/Chrom(?:ium|e)\/(\d+)/) || [])[1];
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)) || '';
  } catch {}
  const isTesla = !!m;
  let computer = 'Unknown';
  if (/AMD|Radeon|Navi/i.test(gpu)) computer = isTesla ? 'MCU3 · AMD Ryzen' : 'AMD';
  else if (/Intel/i.test(gpu)) computer = isTesla ? 'MCU2 · Intel Atom' : 'Intel';
  else if (/NVIDIA|Tegra/i.test(gpu)) computer = isTesla ? 'MCU1 · NVIDIA Tegra' : 'NVIDIA';
  else if (/Apple/i.test(gpu)) computer = 'Apple silicon';

  const version = m?.[1] || null;
  let released = null, holiday = false;
  const vm = version?.match(/^(\d{4})\.(\d{1,2})/);
  if (vm) {
    const year = +vm[1], week = +vm[2];
    released = new Date(year, 0, 1 + (week - 1) * 7).toLocaleDateString([], { month: 'long', year: 'numeric' });
    holiday = week >= 44; // Tesla's holiday releases are the xx.44+ branch
  }
  return {
    isTesla,
    version,
    build: m?.[2] || null,
    released,
    holiday,
    chromium,
    gpu: gpu.replace(/ANGLE \(|\)$/g, '').replace(/, or similar|Direct3D11.*|vs_\d_\d ps_\d_\d/gi, '').trim(),
    computer,
    threads: navigator.hardwareConcurrency || null,
    memoryGb: navigator.deviceMemory || null,
    screen: `${screen.width}×${screen.height}`,
    dpr: devicePixelRatio,
    touch: navigator.maxTouchPoints || 0,
    platform: /X11; GNU\/Linux/.test(ua) ? 'Linux' : navigator.platform || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// ---------------- Connectivity ----------------
export class Connectivity {
  constructor() {
    this.latency = null;
    this.history = [];
    addEventListener('online', () => bus.emit('net', this.snapshot()));
    addEventListener('offline', () => bus.emit('net', this.snapshot()));
  }

  snapshot() {
    const c = navigator.connection || {};
    return { online: navigator.onLine, type: c.effectiveType || null, downlink: c.downlink ?? null, rtt: c.rtt ?? null, latency: this.latency, history: this.history };
  }

  async probe() {
    const t0 = performance.now();
    try {
      await fetch(`https://api.open-meteo.com/v1/elevation?latitude=0&longitude=0&_=${Date.now()}`, { cache: 'no-store' });
      this.latency = Math.round(performance.now() - t0);
    } catch {
      this.latency = null;
    }
    this.history.push(this.latency ?? 0);
    if (this.history.length > 30) this.history.shift();
    bus.emit('net', this.snapshot());
    return this.latency;
  }
}

// ---------------- Elevation ----------------
export class Elevation {
  constructor() {
    this.meters = null;
    this.source = null;
    this.last = null;
    this.busy = false;
    this.profile = []; // recent [t, meters]
  }

  onFix(fix, rawAltitude) {
    if (rawAltitude != null && !Number.isNaN(rawAltitude)) {
      this.set(rawAltitude, 'GPS');
      return;
    }
    const l = this.last;
    if (this.busy || (l && distance(l.lat, l.lon, fix.lat, fix.lon) < 250 && Date.now() - l.t < 120000)) return;
    if (l && Date.now() - l.t < 15000) return;
    this.last = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    this.busy = true;
    fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${fix.lat.toFixed(5)}&longitude=${fix.lon.toFixed(5)}`)
      .then((j) => j.elevation?.[0] != null && this.set(j.elevation[0], 'terrain model'))
      .catch(() => {})
      .finally(() => (this.busy = false));
  }

  set(m, source) {
    const prev = this.meters;
    this.meters = m;
    this.source = source;
    this.profile.push([Date.now(), m]);
    if (this.profile.length > 120) this.profile.shift();
    bus.emit('elevation', { meters: m, delta: prev == null ? 0 : m - prev, source });
  }
}

// ---------------- Energy model ----------------
export const TRIMS = {
  rwd: { label: 'RWD', kwh: 57.5, mass: 1765, crr: 0.0085, cda: 0.505, rated: 215, regenKw: 60 },
  lr: { label: 'Long Range', kwh: 75, mass: 1830, crr: 0.0085, cda: 0.51, rated: 230, regenKw: 70 },
  perf: { label: 'Performance', kwh: 75, mass: 1850, crr: 0.0105, cda: 0.52, rated: 250, regenKw: 70 },
};
const G = 9.81, RHO = 1.2, OCCUPANTS = 150;

export class Energy {
  constructor() {
    this.reset();
  }

  reset() {
    this.wh = 0;
    this.regenWh = 0;
    this.meters = 0;
    this.kw = 0;
    this.prev = null;
  }

  get trim() {
    return TRIMS[settings.get().trim] || TRIMS.lr;
  }

  // Heat pump / AC load from outside temperature (°F).
  auxWatts(tempF) {
    let w = 250;
    if (tempF != null) {
      if (tempF < 55) w += Math.min(3500, (55 - tempF) * 70);
      else if (tempF > 78) w += Math.min(1500, (tempF - 78) * 45);
    }
    return w;
  }

  onFix(fix, tempF) {
    const p = this.prev;
    this.prev = fix;
    if (!p) return;
    const dt = (fix.t - p.t) / 1000;
    if (dt <= 0 || dt > 5) return;
    const T = this.trim;
    const m = T.mass + OCCUPANTS;
    const v = (fix.speed + p.speed) / 2;
    const a = (fix.speed - p.speed) / dt;
    const wheel = m * a * v + m * G * T.crr * v + 0.5 * RHO * T.cda * v ** 3;
    let batt = wheel >= 0 ? wheel / 0.9 : Math.max(wheel * 0.7, -T.regenKw * 1000);
    if (v < 0.5 && wheel <= 0) batt = 0;
    batt += this.auxWatts(tempF);
    this.addWatts(batt, dt);
    this.meters += v * dt;
    this.kw = this.kw * 0.6 + (batt / 1000) * 0.4;
    this.emit();
  }

  // Climbing costs energy; descending recovers some through regen.
  onElevation(deltaM) {
    if (!deltaM || Math.abs(deltaM) > 150) return;
    const j = (this.trim.mass + OCCUPANTS) * G * deltaM;
    const wh = j / 3600;
    this.addWatts(0, 0, deltaM > 0 ? wh / 0.9 : wh * 0.7);
    this.emit();
  }

  addWatts(w, dt, extraWh = 0) {
    const wh = (w * dt) / 3600 + extraWh;
    this.wh += wh;
    if (wh < 0) this.regenWh -= wh;
  }

  get whPerMile() {
    const mi = this.meters / 1609.344;
    return mi > 0.2 ? Math.max(0, this.wh) / mi : null;
  }

  emit() {
    const T = this.trim;
    const whmi = this.whPerMile;
    bus.emit('energy', {
      kwh: Math.max(0, this.wh) / 1000,
      regenKwh: this.regenWh / 1000,
      whPerMile: whmi,
      rated: T.rated,
      kw: this.kw,
      batteryPct: (Math.max(0, this.wh) / 1000 / T.kwh) * 100,
      rangeAtThis: whmi ? (T.kwh * 1000) / whmi : null,
      trim: T.label,
    });
  }
}

// ---------------- Superchargers ----------------
const SC_URL = 'https://supercharge.info/service/supercharge/allSites';

export class Superchargers {
  constructor() {
    this.sites = [];
    this.loading = false;
    this.lastNearest = 0;
    this.nearby = [];
  }

  async load() {
    const cached = await idb.get('superchargers', null);
    if (cached?.sites?.length) this.sites = cached.sites;
    if (!cached || Date.now() - cached.t > 14 * 86400000) this.refresh();
  }

  async refresh() {
    if (this.loading) return;
    this.loading = true;
    try {
      const all = await fetchJSON(SC_URL, { timeout: 90000 });
      this.sites = all
        .filter((s) => s.status === 'OPEN' && s.gps)
        .map((s) => ({ id: s.id, name: s.name, lat: s.gps.latitude, lon: s.gps.longitude, stalls: s.stallCount, kw: s.powerKilowatt, city: s.address?.city, state: s.address?.state }));
      await idb.set('superchargers', { t: Date.now(), sites: this.sites });
      bus.emit('superchargers', this.sites.length);
    } catch (e) {
      bus.emit('net-error', { source: 'Superchargers', message: e.message });
    } finally {
      this.loading = false;
    }
  }

  nearest(lat, lon, k = 3) {
    const cos = Math.cos((lat * Math.PI) / 180);
    const best = [];
    for (const s of this.sites) {
      const dx = (s.lon - lon) * cos, dy = s.lat - lat;
      const d2 = dx * dx + dy * dy;
      if (best.length < k || d2 < best[best.length - 1].d2) {
        best.push({ s, d2 });
        best.sort((a, b) => a.d2 - b.d2);
        if (best.length > k) best.pop();
      }
    }
    return best.map(({ s }) => ({ ...s, meters: distance(lat, lon, s.lat, s.lon) }));
  }

  onFix(fix) {
    if (!this.sites.length || Date.now() - this.lastNearest < 5000) return;
    this.lastNearest = Date.now();
    this.nearby = this.nearest(fix.lat, fix.lon, 3);
    bus.emit('nearest-sc', this.nearby);
  }

  within(bounds) {
    return this.sites.filter((s) => s.lat > bounds.s && s.lat < bounds.n && s.lon > bounds.w && s.lon < bounds.e);
  }
}
