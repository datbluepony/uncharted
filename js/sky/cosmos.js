// "Where are we?" views beyond the sky dome:
//  - Solar System: real heliocentric planet positions (astronomy-engine),
//    orbits traced from the ephemeris, an asteroid belt, a sunlight pulse
//    showing light's 8-minute trip to Earth, and time-lapse.
//  - Galaxy: a procedurally generated barred spiral pre-rendered once, with
//    the Sun's position on the Orion Spur and a live "distance traveled
//    around the galaxy" counter.
/* global Astronomy */
import { PLANET_INFO } from './skydata.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ORDER = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const PERIOD = { Mercury: 87.97, Venus: 224.7, Earth: 365.26, Mars: 686.98, Jupiter: 4332.6, Saturn: 10759, Uranus: 30687, Neptune: 60190 };
const SIZE = { Mercury: 3, Venus: 5, Earth: 5.5, Mars: 4, Jupiter: 11, Saturn: 9.5, Uranus: 7, Neptune: 7 };
const COLOR = { ...Object.fromEntries(Object.entries(PLANET_INFO).map(([k, v]) => [k, v.color])), Earth: '#5fb4ff' };

export class Cosmos {
  constructor(container, { onSelect } = {}) {
    this.el = container;
    this.onSelect = onSelect;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sky-2d';
    container.append(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.mode = 'solar';
    this.view = { zoom: 1, x: 0, y: 0, rot: 0, tilt: 0.55 };
    this.targetZoom = null;
    this.daysPerSec = 0;
    this.simOffset = 0; // ms
    this.selected = null;
    this.pointers = new Map();
    this.openedAt = performance.now();
    this.belt = Array.from({ length: 900 }, () => ({ a: 2.15 + Math.random() * 1.15, th: Math.random() * TAU, s: Math.random() }));
    this.kuiper = Array.from({ length: 700 }, () => ({ a: 32 + Math.random() * 18, th: Math.random() * TAU, s: Math.random() }));
    this.bindInput();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
  }

  setMode(mode) {
    this.mode = mode;
    this.view = mode === 'solar' ? { zoom: 1, x: 0, y: 0, rot: 0, tilt: 0.55 } : { zoom: 1, x: 0, y: 0, rot: 0, tilt: 0.62 };
    this.selected = null;
    if (mode === 'galaxy' && !this.galaxyImg) this.galaxyImg = renderGalaxy(1600);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.dpr = dpr;
    this.W = this.el.clientWidth;
    this.H = this.el.clientHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
  }

  get date() {
    return new Date(Date.now() + this.simOffset);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.simOffset += dt * this.daysPerSec * 86400000;
      if (this.targetZoom != null) {
        this.view.zoom += (this.targetZoom - this.view.zoom) * Math.min(1, dt * 8);
        if (Math.abs(this.targetZoom - this.view.zoom) < 0.001) this.targetZoom = null;
      }
      if (!this.dragging && this.spin) this.view.rot += this.spin * dt, this.spin *= Math.exp(-dt * 3);
      this.mode === 'solar' ? this.drawSolar(t / 1000) : this.drawGalaxy(t / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
  }

  // ---------------- Solar system ----------------
  auToPx(r) {
    // sqrt compression so Mercury and Neptune both fit
    const R = Math.min(this.W, this.H / this.view.tilt) * 0.47 * this.view.zoom;
    return (Math.sqrt(r) / Math.sqrt(31)) * R;
  }

  toScreen(r, angle) {
    const a = angle + this.view.rot;
    const d = this.auToPx(r);
    return { x: this.W / 2 + this.view.x + Math.cos(a) * d, y: this.H / 2 + this.view.y - Math.sin(a) * d * this.view.tilt };
  }

  helio(name, date) {
    const v = Astronomy.HelioVector(name, date);
    const e = Astronomy.Ecliptic(v);
    return { r: Math.hypot(v.x, v.y, v.z), lon: (e.elon * Math.PI) / 180 };
  }

  orbits() {
    if (this._orbits) return this._orbits;
    const base = new Date();
    this._orbits = Object.fromEntries(ORDER.map((name) => {
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const d = new Date(base.getTime() + (i / 160) * PERIOD[name] * 86400000);
        pts.push(this.helio(name, d));
      }
      return [name, pts];
    }));
    return this._orbits;
  }

  drawSolar(time) {
    const { g, W, H } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Background
    const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#070b16');
    bg.addColorStop(1, '#020308');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    this.drawBackgroundStars(g, time);

    const date = this.date;
    const orbits = this.orbits();
    this.screenBodies = [];

    // Orbits
    for (const name of ORDER) {
      g.beginPath();
      orbits[name].forEach((p, i) => {
        const s = this.toScreen(p.r, p.lon);
        i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y);
      });
      g.strokeStyle = name === 'Earth' ? 'rgba(95,180,255,0.45)' : 'rgba(150,180,230,0.14)';
      g.lineWidth = name === 'Earth' ? 1.6 : 1;
      g.stroke();
    }

    // Asteroid and Kuiper belts (slow drift for life)
    const days = date.getTime() / 86400000;
    g.fillStyle = 'rgba(190,170,150,0.35)';
    for (const b of this.belt) {
      const s = this.toScreen(b.a, b.th + days * (TAU / (365.25 * Math.pow(b.a, 1.5))));
      g.fillRect(s.x, s.y, 1 + b.s, 1 + b.s);
    }
    g.fillStyle = 'rgba(150,180,220,0.18)';
    for (const b of this.kuiper) {
      const s = this.toScreen(b.a, b.th + days * (TAU / (365.25 * Math.pow(b.a, 1.5))));
      g.fillRect(s.x, s.y, 1, 1);
    }

    // Sun
    const sun = this.toScreen(0, 0);
    const sr = 16 * Math.sqrt(this.view.zoom);
    const glow = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sr * 6);
    glow.addColorStop(0, 'rgba(255,230,160,0.95)');
    glow.addColorStop(0.2, 'rgba(255,190,90,0.45)');
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(sun.x, sun.y, sr * 6, 0, TAU);
    g.fill();
    g.fillStyle = '#fff4d6';
    g.beginPath();
    g.arc(sun.x, sun.y, sr, 0, TAU);
    g.fill();
    this.screenBodies.push({ name: 'Sun', x: sun.x, y: sun.y, r: sr + 6 });

    // Sunlight pulse: one ring every 8 s reaching Earth's orbit, like light's 8-minute trip
    const earth = this.helio('Earth', date);
    const pulse = (time % 8) / 8;
    const pr = this.auToPx(earth.r * pulse);
    g.strokeStyle = `rgba(255,214,107,${0.35 * (1 - pulse)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(sun.x, sun.y, pr, pr * this.view.tilt, 0, 0, TAU);
    g.stroke();

    // Planets
    for (const name of ORDER) {
      const h = this.helio(name, date);
      const s = this.toScreen(h.r, h.lon);
      const r = SIZE[name] * clamp(Math.sqrt(this.view.zoom), 0.8, 2.2);
      const col = COLOR[name];
      const gl = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3.5);
      gl.addColorStop(0, hexA(col, 0.55));
      gl.addColorStop(1, hexA(col, 0));
      g.fillStyle = gl;
      g.beginPath();
      g.arc(s.x, s.y, r * 3.5, 0, TAU);
      g.fill();
      // shaded sphere, lit from the Sun
      const lx = sun.x - s.x, ly = sun.y - s.y, ll = Math.hypot(lx, ly) || 1;
      const sph = g.createRadialGradient(s.x + (lx / ll) * r * 0.4, s.y + (ly / ll) * r * 0.4, r * 0.1, s.x, s.y, r);
      sph.addColorStop(0, '#ffffff');
      sph.addColorStop(0.25, col);
      sph.addColorStop(1, shade(col, 0.35));
      g.fillStyle = sph;
      g.beginPath();
      g.arc(s.x, s.y, r, 0, TAU);
      g.fill();
      if (name === 'Saturn') {
        g.strokeStyle = 'rgba(240,216,144,0.75)';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(s.x, s.y, r * 2.1, r * 0.75, -0.3, 0, TAU);
        g.stroke();
      }
      if (name === 'Earth') {
        // Moon (not to scale) and "you are here"
        const ma = (date.getTime() / 86400000 / 27.32) * TAU;
        g.fillStyle = '#d9dde8';
        g.beginPath();
        g.arc(s.x + Math.cos(ma) * r * 2.6, s.y - Math.sin(ma) * r * 2.6 * this.view.tilt, 1.8, 0, TAU);
        g.fill();
        const pr2 = r + 8 + ((time * 14) % 18);
        g.strokeStyle = `rgba(124,247,212,${1 - ((time * 14) % 18) / 18})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(s.x, s.y, pr2, 0, TAU);
        g.stroke();
        g.font = '800 15px -apple-system, "Segoe UI", sans-serif';
        g.fillStyle = '#7cf7d4';
        g.textAlign = 'left';
        g.fillText('You are here', s.x + r + 14, s.y - 8);
        g.font = '500 12px -apple-system, "Segoe UI", sans-serif';
        g.fillStyle = 'rgba(200,230,240,0.8)';
        g.fillText('Andrew & Jenna · Earth', s.x + r + 14, s.y + 9);
      } else {
        g.font = '600 13px -apple-system, "Segoe UI", sans-serif';
        g.fillStyle = 'rgba(220,230,245,0.85)';
        g.textAlign = 'center';
        g.fillText(name, s.x, s.y + r + 18);
      }
      if (this.selected === name) {
        g.strokeStyle = '#7cf7d4';
        g.lineWidth = 2;
        g.setLineDash([5, 5]);
        g.lineDashOffset = -time * 20;
        g.beginPath();
        g.arc(s.x, s.y, r + 12, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      }
      this.screenBodies.push({ name, x: s.x, y: s.y, r: Math.max(r + 10, 22), helio: h });
    }

    g.font = '500 12px -apple-system, "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(160,180,210,0.6)';
    g.textAlign = 'right';
    g.fillText('Distances compressed so the outer planets fit · positions are real for the date shown', W - 20, H - 150);
  }

  // ---------------- Galaxy ----------------
  drawGalaxy(time) {
    const { g, W, H } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#010207';
    g.fillRect(0, 0, W, H);
    this.drawBackgroundStars(g, time);
    const img = this.galaxyImg;
    const size = Math.min(W, H / this.view.tilt) * 0.95 * this.view.zoom;
    const rot = this.view.rot + time * 0.01;
    const cx = W / 2 + this.view.x, cy = H / 2 + this.view.y;
    g.save();
    g.translate(cx, cy);
    g.scale(1, this.view.tilt);
    g.rotate(rot);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(img, -size / 2, -size / 2, size, size);
    g.restore();
    g.globalCompositeOperation = 'source-over';

    // Sun on the Orion Spur: ~26,000 ly out of a ~50,000 ly radius
    const sunAng = rot + 2.4;
    const sr = size / 2 * 0.52;
    const sx = cx + Math.cos(sunAng) * sr, sy = cy + Math.sin(sunAng) * sr * this.view.tilt;
    const pulse = (time * 0.8) % 1;
    g.strokeStyle = `rgba(124,247,212,${1 - pulse})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(sx, sy, 6 + pulse * 26, 0, TAU);
    g.stroke();
    g.fillStyle = '#7cf7d4';
    g.beginPath();
    g.arc(sx, sy, 4.5, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(124,247,212,0.6)';
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + 60, sy - 60);
    g.lineTo(sx + 150, sy - 60);
    g.stroke();
    g.textAlign = 'left';
    g.font = '800 16px -apple-system, "Segoe UI", sans-serif';
    g.fillStyle = '#7cf7d4';
    g.fillText('You are here', sx + 66, sy - 68);
    g.font = '500 12px -apple-system, "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(210,235,240,0.85)';
    g.fillText('The Sun · Orion Spur · 26,000 light-years from the center', sx + 66, sy - 48);

    // Galactic center label
    g.fillStyle = 'rgba(255,220,170,0.9)';
    g.font = '600 13px -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.fillText('Sagittarius A* (black hole)', cx, cy + size * 0.07 * this.view.tilt + 34);

    // Andromeda pointer
    g.textAlign = 'right';
    g.fillStyle = 'rgba(205,170,255,0.8)';
    g.fillText('Andromeda Galaxy, 2.5 million light-years →', W - 24, 150);

    this.screenBodies = [
      { name: 'SunGalactic', x: sx, y: sy, r: 30 },
      { name: 'GalacticCenter', x: cx, y: cy, r: 40 },
    ];

    // Scale bar
    const px10k = size / 2 * 0.2;
    g.strokeStyle = 'rgba(200,215,240,0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(24, H - 150);
    g.lineTo(24 + px10k, H - 150);
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = 'rgba(200,215,240,0.8)';
    g.fillText('10,000 light-years', 24, H - 160);
  }

  drawBackgroundStars(g, time) {
    if (!this.bgStars) this.bgStars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2, p: Math.random() * TAU }));
    for (const s of this.bgStars) {
      g.fillStyle = `rgba(210,225,255,${0.25 + 0.35 * Math.abs(Math.sin(time * 0.8 + s.p))})`;
      g.fillRect(s.x * this.W, s.y * this.H, s.r, s.r);
    }
  }

  // ---------------- input ----------------
  bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
        this.dragging = true;
        this.spin = 0;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.view.zoom };
        this.down && (this.down.moved = true);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        this.view.zoom = clamp(this.pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d), 0.5, 12);
        return;
      }
      if (!this.down) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) this.down.moved = true;
      if (!this.down.moved) return;
      // Horizontal drag rotates, vertical drag tilts
      this.view.rot += dx * 0.005;
      this.spin = dx * 0.3;
      this.view.tilt = clamp(this.view.tilt - dy * 0.002, 0.18, 1);
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size) return;
      this.dragging = false;
      const d = this.down;
      if (d && !d.moved && performance.now() - d.t < 400) {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const hit = (this.screenBodies || []).filter((b) => Math.hypot(b.x - x, b.y - y) < b.r).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        this.selected = hit?.name || null;
        this.onSelect?.(hit || null);
      }
      this.down = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetZoom = clamp((this.targetZoom ?? this.view.zoom) * Math.exp(-e.deltaY * 0.0012), 0.5, 12);
    }, { passive: false });
  }
}

// Procedural barred spiral galaxy, rendered once to an offscreen canvas.
function renderGalaxy(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const C = S / 2;
  g.globalCompositeOperation = 'lighter';
  const rnd = mulberry(7);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };

  // Diffuse disk and bulge
  const disk = g.createRadialGradient(C, C, 0, C, C, C);
  disk.addColorStop(0, 'rgba(255,220,170,0.55)');
  disk.addColorStop(0.08, 'rgba(255,200,150,0.35)');
  disk.addColorStop(0.3, 'rgba(140,160,220,0.10)');
  disk.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = disk;
  g.fillRect(0, 0, S, S);

  // Bar
  g.save();
  g.translate(C, C);
  g.rotate(0.45);
  g.scale(1, 0.32);
  const bar = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.12);
  bar.addColorStop(0, 'rgba(255,230,190,0.8)');
  bar.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = bar;
  g.beginPath();
  g.arc(0, 0, S * 0.12, 0, TAU);
  g.fill();
  g.restore();

  // Arms: stars along log spirals
  const arms = 4;
  for (let i = 0; i < 42000; i++) {
    const arm = i % arms;
    const t = Math.pow(rnd(), 0.75);
    const r = (0.1 + t * 0.9) * C * 0.95;
    const theta = arm * (TAU / arms) + 0.45 + Math.log(r / (C * 0.1)) / Math.tan(0.42) + gauss() * (0.16 + 0.12 * t);
    const x = C + Math.cos(theta) * r + gauss() * 9;
    const y = C + Math.sin(theta) * r + gauss() * 9;
    const young = rnd() < 0.7;
    const a = 0.08 + rnd() * 0.25;
    g.fillStyle = young ? `rgba(170,200,255,${a})` : `rgba(255,230,200,${a})`;
    const s = rnd() < 0.02 ? 2.2 : 1.1;
    g.fillRect(x, y, s, s);
    if (rnd() < 0.0015) {
      const neb = g.createRadialGradient(x, y, 0, x, y, 6);
      neb.addColorStop(0, 'rgba(255,120,170,0.18)');
      neb.addColorStop(1, 'rgba(255,120,170,0)');
      g.fillStyle = neb;
      g.fillRect(x - 7, y - 7, 14, 14);
    }
  }
  // Scattered disk stars
  for (let i = 0; i < 16000; i++) {
    const r = Math.abs(gauss()) * C * 0.35;
    const th = rnd() * TAU;
    g.fillStyle = `rgba(230,225,255,${0.05 + rnd() * 0.12})`;
    g.fillRect(C + Math.cos(th) * r, C + Math.sin(th) * r, 1, 1);
  }
  // Dust lanes (darken along the inner edge of each arm)
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9000; i++) {
    const arm = i % arms;
    const t = Math.pow(rnd(), 0.8);
    const r = (0.14 + t * 0.8) * C * 0.95;
    const theta = arm * (TAU / arms) + 0.3 + Math.log(r / (C * 0.1)) / Math.tan(0.42) + gauss() * 0.06;
    g.fillStyle = `rgba(0,0,0,${0.06 + rnd() * 0.08})`;
    g.beginPath();
    g.arc(C + Math.cos(theta) * r, C + Math.sin(theta) * r, 2 + rnd() * 4, 0, TAU);
    g.fill();
  }
  // Bright core
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(C, C, 0, C, C, S * 0.05);
  core.addColorStop(0, 'rgba(255,250,235,1)');
  core.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = core;
  g.fillRect(C - S * 0.05, C - S * 0.05, S * 0.1, S * 0.1);
  return c;
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}
