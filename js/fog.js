// Fog of war: a grid of ~45 m cells. Every cell you drive through is
// revealed forever. Rendered as a canvas overlay punched with soft holes.
import { bus, idb, distance } from './util.js';

const CELL = 0.0004; // degrees latitude (~44 m)
const CELL_M = CELL * 111320;
const BUCKET = 64; // cells per spatial bucket side
const REVEAL_M = 55; // reveal radius around the car

export class Fog {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cells = new Set();
    this.buckets = new Map(); // "by:bx" -> [[lat, lon], ...]
    this.todayNew = 0;
    this.prevFix = null;
    this.dirty = false;
    this.sprite = makeSprite();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  async load() {
    const arr = await idb.get('fogCells', []);
    for (const k of arr) this.addKey(k);
    setInterval(() => this.save(), 15000);
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    idb.set('fogCells', [...this.cells]);
  }

  get areaKm2() {
    return (this.cells.size * CELL_M * CELL_M) / 1e6;
  }

  keyFor(lat, lon) {
    const cy = Math.floor(lat / CELL);
    const lonCell = CELL / Math.cos(((cy + 0.5) * CELL * Math.PI) / 180);
    const cx = Math.floor(lon / lonCell);
    return `${cy}:${cx}`;
  }

  centerOf(key) {
    const [cy, cx] = key.split(':').map(Number);
    const lat = (cy + 0.5) * CELL;
    const lonCell = CELL / Math.cos((lat * Math.PI) / 180);
    return [lat, (cx + 0.5) * lonCell];
  }

  addKey(key) {
    if (this.cells.has(key)) return false;
    this.cells.add(key);
    const [cy, cx] = key.split(':').map(Number);
    const bk = `${Math.floor(cy / BUCKET)}:${Math.floor(cx / BUCKET)}`;
    let b = this.buckets.get(bk);
    if (!b) this.buckets.set(bk, (b = []));
    b.push(this.centerOf(key));
    return true;
  }

  isVisited(lat, lon) {
    return this.cells.has(this.keyFor(lat, lon));
  }

  // Reveal along the path from the previous fix (GPS fixes can be 30+ m apart).
  reveal(fix) {
    if (fix.acc > 60) return 0;
    const pts = [[fix.lat, fix.lon]];
    const p = this.prevFix;
    if (p) {
      const d = distance(p.lat, p.lon, fix.lat, fix.lon);
      if (d < 400) {
        const n = Math.floor(d / 20);
        for (let i = 1; i <= n; i++) pts.push([p.lat + ((fix.lat - p.lat) * i) / (n + 1), p.lon + ((fix.lon - p.lon) * i) / (n + 1)]);
      }
    }
    this.prevFix = fix;
    let added = 0;
    for (const [lat, lon] of pts) added += this.revealAround(lat, lon);
    if (added) {
      this.dirty = true;
      this.todayNew += added;
      bus.emit('fog', { added, areaKm2: this.areaKm2, cells: this.cells.size });
    }
    return added;
  }

  revealAround(lat, lon) {
    let added = 0;
    const r = Math.ceil(REVEAL_M / CELL_M);
    const lonStep = CELL / Math.cos((lat * Math.PI) / 180);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        if (this.addKey(this.keyFor(lat + dy * CELL, lon + dx * lonStep))) added++;
      }
    }
    return added;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
  }

  draw(map, { opacity = 0.62 } = {}) {
    const { ctx, canvas, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgba(3, 5, 9, ${opacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.cells.size) return;

    const b = map.getBounds();
    const s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
    const pad = CELL * 4;
    const cyMin = Math.floor((s - pad) / CELL / BUCKET), cyMax = Math.floor((n + pad) / CELL / BUCKET);
    const lonCell = CELL / Math.cos((((s + n) / 2) * Math.PI) / 180);
    const cxMin = Math.floor((w - pad) / lonCell / BUCKET) - 1, cxMax = Math.floor((e + pad) / lonCell / BUCKET) + 1;
    if ((cyMax - cyMin) * (cxMax - cxMin) > 4000) return; // zoomed way out: skip holes

    // Pixel radius: project a point REVEAL_M*1.3 east of the view center.
    const c = map.getCenter();
    const p0 = map.project(c);
    const p1 = map.project([c.lng + (REVEAL_M * 1.4) / (111320 * Math.cos((c.lat * Math.PI) / 180)), c.lat]);
    const baseR = Math.max(3, Math.hypot(p1.x - p0.x, p1.y - p0.y)) * dpr;

    ctx.globalCompositeOperation = 'destination-out';
    const H = canvas.height;
    for (let by = cyMin; by <= cyMax; by++) {
      for (let bx = cxMin; bx <= cxMax; bx++) {
        const arr = this.buckets.get(`${by}:${bx}`);
        if (!arr) continue;
        for (const [lat, lon] of arr) {
          if (lat < s - pad || lat > n + pad || lon < w - pad || lon > e + pad) continue;
          const pt = map.project([lon, lat]);
          const x = pt.x * dpr, y = pt.y * dpr;
          // Pitched views shrink distant holes; scale with screen height.
          const r = baseR * (0.45 + 0.75 * (y / H));
          if (x < -r || y < -r || x > canvas.width + r || y > H + r) continue;
          ctx.drawImage(this.sprite, x - r, y - r, r * 2, r * 2);
        }
      }
    }
  }
}

function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}
