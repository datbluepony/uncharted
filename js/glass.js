// Glass of water: a smooth-driving coach. Longitudinal and lateral
// acceleration are derived from GPS speed and heading changes and drive a
// spring-damper water surface. Hard inputs spill water and cost points.
import { bus, angleDiff, clamp } from './util.js';

const G = 9.81;
const SPILL_G = 0.3; // combined g that spills
const WARN_G = 0.17;

export class Glass {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.prev = null;
    this.aLong = 0;
    this.aLat = 0;
    this.tilt = 0; // radians
    this.tiltV = 0;
    this.wave = 0;
    this.waveV = 0;
    this.level = 0.72;
    this.drops = [];
    this.lastSpill = 0;
    this.reset();
    requestAnimationFrame((t) => this.frame(t));
  }

  reset() {
    this.score = 100;
    this.spills = 0;
    this.peakG = 0;
    this.level = 0.72;
    this.emit();
  }

  onFix(fix) {
    const p = this.prev;
    this.prev = fix;
    if (!p || fix.acc > 30) return;
    const dt = (fix.t - p.t) / 1000;
    if (dt <= 0.2 || dt > 3) return;

    const aLong = clamp((fix.speed - p.speed) / dt, -12, 12);
    let aLat = 0;
    if (fix.speed > 3 && p.heading != null && fix.heading != null) {
      const w = (angleDiff(p.heading, fix.heading) * Math.PI) / 180 / dt; // yaw rate rad/s
      aLat = clamp(fix.speed * w, -12, 12);
    }
    // Light smoothing: GPS speed is already filtered by the receiver.
    this.aLong = this.aLong * 0.35 + aLong * 0.65;
    this.aLat = this.aLat * 0.35 + aLat * 0.65;

    const g = Math.hypot(this.aLong, this.aLat) / G;
    this.peakG = Math.max(this.peakG, g);
    if (fix.speed > 1.5 || p.speed > 1.5) {
      if (g > WARN_G) this.score = Math.max(0, this.score - (g - WARN_G) * 6 * dt);
      const now = performance.now();
      if (g > SPILL_G && now - this.lastSpill > 3500) {
        this.lastSpill = now;
        this.spills++;
        this.score = Math.max(0, this.score - 4);
        this.level = Math.max(0.35, this.level - 0.035);
        this.spawnDrops(this.aLat);
        document.getElementById('glassBox')?.classList.add('spill');
        setTimeout(() => document.getElementById('glassBox')?.classList.remove('spill'), 450);
        bus.emit('spill', { g, kind: Math.abs(this.aLat) > Math.abs(this.aLong) ? 'corner' : this.aLong < 0 ? 'brake' : 'accel' });
      }
    }
    // Kick the water: braking pushes it forward (shown as a wave), turns tilt it.
    this.waveV += (-this.aLong / G) * 2.2;
    this.emit();
  }

  emit() {
    bus.emit('glass', { score: Math.round(this.score), spills: this.spills, peakG: this.peakG });
  }

  spawnDrops(aLat) {
    const dir = aLat >= 0 ? -1 : 1; // water leaves opposite to the turn
    for (let i = 0; i < 14; i++) {
      this.drops.push({ x: 110 + dir * 70, y: 48, vx: dir * (40 + Math.random() * 90), vy: -60 - Math.random() * 80, life: 1 });
    }
  }

  frame(t) {
    const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000);
    this.lastT = t;
    // Water surface tilts toward the outside of the turn.
    const targetTilt = clamp(Math.atan2(this.aLat, G) * 2.4, -0.55, 0.55);
    this.tiltV += ((targetTilt - this.tilt) * 30 - this.tiltV * 4.5) * dt;
    this.tilt += this.tiltV * dt;
    this.waveV += (-this.wave * 40 - this.waveV * 2.5) * dt;
    this.wave += this.waveV * dt;
    // Decay accel so the water settles when fixes stop.
    this.aLong *= 1 - dt * 0.8;
    this.aLat *= 1 - dt * 0.8;
    this.draw(t / 1000, dt);
    requestAnimationFrame((tt) => this.frame(tt));
  }

  draw(time, dt) {
    const { ctx } = this;
    const W = 220, H = 260;
    ctx.clearRect(0, 0, W, H);
    // Glass shape (slightly tapered)
    const top = 30, bot = 238, tl = 30, tr = 190, bl = 52, br = 168;
    const glassPath = new Path2D();
    glassPath.moveTo(tl, top);
    glassPath.lineTo(bl, bot);
    glassPath.quadraticCurveTo(110, bot + 12, br, bot);
    glassPath.lineTo(tr, top);

    const g = Math.hypot(this.aLong, this.aLat) / G;
    const hue = g > SPILL_G ? '255,90,106' : g > WARN_G ? '255,181,71' : '63,182,255';

    ctx.save();
    ctx.clip(glassPath);
    const surfaceY = bot - (bot - top) * this.level;
    const slope = Math.tan(this.tilt);
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const ripple = Math.sin(x / 18 + time * 4) * (1.5 + Math.abs(this.wave) * 6) + Math.sin(x / 9 - time * 6) * Math.abs(this.wave) * 4;
      const y = surfaceY + (x - 110) * slope + ripple + this.wave * 14 * ((x - 110) / 110);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, surfaceY - 40, 0, bot);
    grad.addColorStop(0, `rgba(${hue},0.95)`);
    grad.addColorStop(1, `rgba(${hue},0.35)`);
    ctx.fillStyle = grad;
    ctx.fill();
    // bubbles
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i++) {
      const bx = 70 + ((i * 37) % 80);
      const by = bot - ((time * (18 + i * 5) + i * 40) % (bot - surfaceY));
      ctx.beginPath();
      ctx.arc(bx, by, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Glass outline + shine
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(220,235,255,0.75)';
    ctx.stroke(glassPath);
    ctx.beginPath();
    ctx.moveTo(tl + 16, top + 16);
    ctx.lineTo(bl + 12, bot - 30);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();

    // Drops
    this.drops = this.drops.filter((d) => d.life > 0);
    for (const d of this.drops) {
      d.vy += 420 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt * 1.2;
      ctx.fillStyle = `rgba(${hue},${Math.max(0, d.life)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // g meter
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 16px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${g.toFixed(2)} g`, 110, 20);
  }
}
