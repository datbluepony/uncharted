// Shared helpers: geo math, event bus, persistence, settings.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distance(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(aLat, aLon, bLat, bLon) {
  const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Signed smallest difference b - a in degrees, range (-180, 180]
export function angleDiff(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

export function offset(lat, lon, meters, brg) {
  const d = meters / R;
  const b = rad(brg);
  const la = rad(lat);
  const lo = rad(lon);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [deg(la2), deg(lo2)];
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Units ----
export function fmtDist(m, units = settings.get().units) {
  if (units === 'metric') return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  const mi = m / 1609.344;
  return mi < 0.1 ? `${Math.round(m * 3.28084 / 50) * 50} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}
export function fmtSpeed(mps, units = settings.get().units) {
  return units === 'metric' ? Math.round(mps * 3.6) : Math.round(mps * 2.23694);
}
export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ---- Event bus ----
const target = new EventTarget();
export const bus = {
  on(type, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(type, h);
    return () => target.removeEventListener(type, h);
  },
  emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};

// ---- localStorage JSON (small data) ----
export const ls = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('uc:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('uc:' + key, JSON.stringify(value));
    } catch {}
  },
};

// ---- IndexedDB key/value (large data: trips, fog cells, places) ----
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('uncharted', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbp;
}
const memKV = new Map();
export const idb = {
  async get(key, fallback) {
    const d = await db();
    if (!d) return memKV.has(key) ? memKV.get(key) : fallback;
    return new Promise((resolve) => {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result === undefined ? fallback : r.result);
      r.onerror = () => resolve(fallback);
    });
  },
  async set(key, value) {
    const d = await db();
    if (!d) return void memKV.set(key, value);
    return new Promise((resolve) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },
  async clear() {
    const d = await db();
    memKV.clear();
    if (!d) return;
    return new Promise((resolve) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').clear();
      tx.oncomplete = () => resolve();
    });
  },
};

// ---- Settings ----
const DEFAULTS = {
  units: 'imperial',
  voice: true,
  storyLength: 'short', // short | long
  storyFreq: 'normal', // chill | normal | chatty
  categories: { history: true, nature: true, town: true, culture: true, structure: true, oddity: true },
  showGlass: true,
  pitch: 60,
  wazeFeedUrl: '', // optional proxy returning Waze georss JSON for spoken alerts
  alertVoice: true,
};
let current = { ...DEFAULTS, ...ls.get('settings', {}) };
current.categories = { ...DEFAULTS.categories, ...(current.categories || {}) };
export const settings = {
  get: () => current,
  set(patch) {
    current = { ...current, ...patch };
    ls.set('settings', current);
    bus.emit('settings', current);
  },
};

// ---- Fetch with timeout ----
export async function fetchJSON(url, { timeout = 12000, ...opts } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}
