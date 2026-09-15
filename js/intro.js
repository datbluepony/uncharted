// Animated opening scene: night sky with aurora and an "A ✦ J" constellation,
// a road running to the horizon through drifting fog, and a Model 3 cruising
// away from the viewer. Canvas-only, capped at ~30 fps, stops when dismissed.

export class Intro {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.running = true;
    this.last = 0;
    this.start = performance.now();
    this.stars = [];
    this.shoot = null;
    this.resize();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.dpr = dpr;
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    const n = Math.round((this.W * this.H) / 3500);
    this.stars = Array.from({ length: n }, () => ({
      x: Math.random() * this.W,
      y: Math.random() * this.H * 0.6,
      r: Math.random() ** 3 * 1.8 + 0.3,
      tw: 0.5 + Math.random() * 2.5,
      ph: Math.random() * Math.PI * 2,
    }));
  }

  stop() {
    this.running = false;
    removeEventListener('resize', this.onResize);
  }

  loop(t) {
    if (!this.running) return;
    requestAnimationFrame((tt) => this.loop(tt));
    if (t - this.last < 30 || document.hidden) return;
    this.last = t;
    this.draw((t - this.start) / 1000);
  }

  draw(time) {
    const { g, W, H } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const hz = H * 0.6; // horizon

    // Sky
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#03050b');
    sky.addColorStop(0.55, '#081328');
    sky.addColorStop(1, '#16294a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, hz + 2);

    // Aurora ribbons
    g.save();
    g.globalCompositeOperation = 'lighter';
    const ribbons = [
      ['rgba(63,182,255,0.07)', 0.0035, 0.18, H * 0.2, 70],
      ['rgba(124,247,212,0.06)', 0.0026, -0.13, H * 0.27, 90],
      ['rgba(195,139,255,0.045)', 0.0042, 0.1, H * 0.15, 55],
    ];
    for (const [color, freq, speed, y0, width] of ribbons) {
      g.beginPath();
      for (let x = -20; x <= W + 20; x += 16) {
        const y = y0 + Math.sin(x * freq + time * speed) * 38 + Math.sin(x * freq * 2.3 - time * speed * 1.7) * 14;
        x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.filter = 'blur(18px)';
      g.stroke();
    }
    g.filter = 'none';
    g.restore();

    // Stars
    for (const s of this.stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(time * s.tw + s.ph));
      g.fillStyle = `rgba(220,235,255,${a * (1 - s.y / (hz * 1.05))})`;
      g.beginPath();
      g.arc((s.x - time * s.r * 1.2 + W * 10) % W, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }

    this.drawConstellation(time);
    this.drawShootingStar(time);

    // Hills
    const hill = (color, amp, freq, off, lift) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, hz + 2);
      for (let x = 0; x <= W; x += 10) {
        g.lineTo(x, hz - lift - Math.abs(Math.sin(x * freq + off)) * amp - Math.sin(x * freq * 3.1 + off) * amp * 0.25);
      }
      g.lineTo(W, hz + 2);
      g.fill();
    };
    hill('#0b1528', H * 0.07, 0.0022, 1.3, H * 0.01);
    hill('#070d19', H * 0.045, 0.004, 4.1, -H * 0.005);

    // Ground
    const ground = g.createLinearGradient(0, hz, 0, H);
    ground.addColorStop(0, '#060a13');
    ground.addColorStop(1, '#020306');
    g.fillStyle = ground;
    g.fillRect(0, hz, W, H - hz);

    // Road
    const cx = W / 2;
    const bottomHalf = Math.min(W * 0.46, 900);
    g.fillStyle = '#0a0e17';
    g.beginPath();
    g.moveTo(cx - 3, hz);
    g.lineTo(cx + 3, hz);
    g.lineTo(cx + bottomHalf, H);
    g.lineTo(cx - bottomHalf, H);
    g.fill();
    // Glowing edges
    for (const side of [-1, 1]) {
      const edge = g.createLinearGradient(0, hz, 0, H);
      edge.addColorStop(0, 'rgba(63,182,255,0)');
      edge.addColorStop(1, 'rgba(63,182,255,0.55)');
      g.strokeStyle = edge;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx + side * 3, hz);
      g.lineTo(cx + side * bottomHalf * 0.94, H);
      g.stroke();
    }
    // Lane dashes rushing toward the viewer
    const N = 14;
    for (let i = 0; i < N; i++) {
      const z = ((i + time * 1.6) % N) / N; // 0 at horizon → 1 at viewer
      const z2 = ((i + 0.45 + time * 1.6) % N) / N;
      if (z2 < z) continue;
      const y1 = hz + (H - hz) * z * z;
      const y2 = hz + (H - hz) * z2 * z2;
      g.fillStyle = `rgba(230,240,255,${0.15 + 0.7 * z})`;
      const w1 = 1 + 7 * z, w2 = 1 + 7 * z2;
      g.beginPath();
      g.moveTo(cx - w1 / 2, y1);
      g.lineTo(cx + w1 / 2, y1);
      g.lineTo(cx + w2 / 2, y2);
      g.lineTo(cx - w2 / 2, y2);
      g.fill();
    }

    // Fog drifting over the horizon
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const fx = ((i * 0.27 + time * 0.012 * (i % 2 ? 1 : -1)) % 1 + 1) % 1;
      const grad = g.createRadialGradient(fx * W, hz - 6 + i * 6, 0, fx * W, hz - 6 + i * 6, W * 0.28);
      grad.addColorStop(0, 'rgba(120,160,210,0.07)');
      grad.addColorStop(1, 'rgba(120,160,210,0)');
      g.fillStyle = grad;
      g.fillRect(0, hz - H * 0.2, W, H * 0.35);
    }
    g.restore();

    // The car
    const carW = Math.min(W * 0.2, 360);
    this.drawCar(cx + Math.sin(time * 0.55) * W * 0.012, H * 0.9, carW, time);

    // Vignette
    const vig = g.createRadialGradient(cx, H * 0.45, Math.min(W, H) * 0.3, cx, H * 0.5, Math.max(W, H) * 0.8);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }

  drawConstellation(time) {
    const { g, W, H } = this;
    const pts = [
      [0.74, 0.2, 'A'], [0.765, 0.145], [0.79, 0.125], [0.815, 0.15], [0.84, 0.11, 'J'],
    ].map(([x, y, label]) => [x * W, y * H, label]);
    const draw = Math.min(1, Math.max(0, (time - 0.6) / 2.4)); // line draws over ~2.4 s
    // Line
    g.save();
    g.strokeStyle = 'rgba(160,215,255,0.45)';
    g.lineWidth = 1.2;
    g.setLineDash([4, 5]);
    g.beginPath();
    const segs = pts.length - 1;
    const upto = draw * segs;
    for (let i = 0; i < segs; i++) {
      if (i > upto) break;
      const f = Math.min(1, upto - i);
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (i === 0) g.moveTo(x1, y1);
      g.lineTo(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
    }
    g.stroke();
    g.restore();
    // Stars
    for (const [x, y, label] of pts) {
      const big = !!label;
      const pulse = 0.75 + 0.25 * Math.sin(time * 2 + x);
      const r = big ? 3.2 : 1.8;
      const halo = g.createRadialGradient(x, y, 0, x, y, big ? 26 : 12);
      halo.addColorStop(0, `rgba(190,230,255,${0.55 * pulse})`);
      halo.addColorStop(1, 'rgba(190,230,255,0)');
      g.fillStyle = halo;
      g.fillRect(x - 30, y - 30, 60, 60);
      g.fillStyle = '#eef7ff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (label) {
        g.fillStyle = `rgba(200,230,255,${Math.min(1, Math.max(0, time - 2.6)) * 0.85})`;
        g.font = '600 15px -apple-system, Segoe UI, sans-serif';
        g.textAlign = 'center';
        g.fillText(label, x, y + 26);
      }
    }
  }

  drawShootingStar(time) {
    const { g, W, H } = this;
    if (!this.shoot && Math.random() < 0.006) {
      this.shoot = { x: Math.random() * W * 0.6, y: Math.random() * H * 0.25, t: time };
    }
    const s = this.shoot;
    if (!s) return;
    const p = (time - s.t) / 0.9;
    if (p > 1) {
      this.shoot = null;
      return;
    }
    const x = s.x + p * W * 0.25, y = s.y + p * H * 0.12;
    const grad = g.createLinearGradient(x, y, x - 120, y - 58);
    grad.addColorStop(0, `rgba(255,255,255,${1 - p})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 120, y - 58);
    g.stroke();
  }

  // Stylized rear view of a Model 3.
  drawCar(cx, by, w, time) {
    const g = this.g;
    const h = w * 0.44;
    // Red light spill on the road
    const spill = g.createRadialGradient(cx, by + h * 0.05, 0, cx, by + h * 0.05, w * 0.9);
    spill.addColorStop(0, 'rgba(255,40,60,0.28)');
    spill.addColorStop(1, 'rgba(255,40,60,0)');
    g.fillStyle = spill;
    g.fillRect(cx - w, by - h * 0.4, w * 2, h * 1.2);
    // Shadow
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.ellipse(cx, by + 3, w * 0.56, h * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    // Tires
    g.fillStyle = '#030406';
    g.beginPath();
    g.roundRect(cx - w * 0.47, by - h * 0.3, w * 0.15, h * 0.32, 7);
    g.roundRect(cx + w * 0.32, by - h * 0.3, w * 0.15, h * 0.32, 7);
    g.fill();
    // Body
    const body = new Path2D();
    body.moveTo(cx - w * 0.5, by - h * 0.14);
    body.quadraticCurveTo(cx - w * 0.53, by - h * 0.5, cx - w * 0.41, by - h * 0.6);
    body.lineTo(cx - w * 0.31, by - h * 0.64);
    body.bezierCurveTo(cx - w * 0.26, by - h * 0.92, cx - w * 0.14, by - h * 1.02, cx, by - h * 1.02);
    body.bezierCurveTo(cx + w * 0.14, by - h * 1.02, cx + w * 0.26, by - h * 0.92, cx + w * 0.31, by - h * 0.64);
    body.lineTo(cx + w * 0.41, by - h * 0.6);
    body.quadraticCurveTo(cx + w * 0.53, by - h * 0.5, cx + w * 0.5, by - h * 0.14);
    body.quadraticCurveTo(cx, by - h * 0.02, cx - w * 0.5, by - h * 0.14);
    const paint = g.createLinearGradient(0, by - h, 0, by);
    paint.addColorStop(0, '#3a4557');
    paint.addColorStop(0.45, '#1b222d');
    paint.addColorStop(1, '#0a0d13');
    g.fillStyle = paint;
    g.fill(body);
    g.strokeStyle = 'rgba(170,210,255,0.22)';
    g.lineWidth = 1.5;
    g.stroke(body);
    // Rear glass
    const glass = new Path2D();
    glass.moveTo(cx - w * 0.28, by - h * 0.66);
    glass.bezierCurveTo(cx - w * 0.23, by - h * 0.9, cx - w * 0.12, by - h * 0.97, cx, by - h * 0.97);
    glass.bezierCurveTo(cx + w * 0.12, by - h * 0.97, cx + w * 0.23, by - h * 0.9, cx + w * 0.28, by - h * 0.66);
    glass.closePath();
    const gl = g.createLinearGradient(cx - w * 0.3, by - h, cx + w * 0.3, by - h * 0.6);
    gl.addColorStop(0, '#0b111c');
    gl.addColorStop(0.5, '#243349');
    gl.addColorStop(1, '#0b111c');
    g.fillStyle = gl;
    g.fill(glass);
    // Moving reflection across the glass
    g.save();
    g.clip(glass);
    const rx = cx - w * 0.4 + ((time * 0.25) % 1.6) * w * 0.8;
    const refl = g.createLinearGradient(rx - 30, 0, rx + 30, 0);
    refl.addColorStop(0, 'rgba(160,215,255,0)');
    refl.addColorStop(0.5, 'rgba(160,215,255,0.18)');
    refl.addColorStop(1, 'rgba(160,215,255,0)');
    g.fillStyle = refl;
    g.fillRect(cx - w * 0.5, by - h, w, h * 0.4);
    g.restore();
    // Trunk line
    g.strokeStyle = 'rgba(170,210,255,0.16)';
    g.beginPath();
    g.moveTo(cx - w * 0.36, by - h * 0.44);
    g.quadraticCurveTo(cx, by - h * 0.4, cx + w * 0.36, by - h * 0.44);
    g.stroke();
    // Tail lights
    const glow = 0.85 + 0.15 * Math.sin(time * 2.2);
    g.save();
    g.shadowColor = `rgba(255,30,50,${glow})`;
    g.shadowBlur = 28;
    g.fillStyle = `rgba(255,${40 + 30 * glow},${60 + 20 * glow},1)`;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + side * w * 0.47, by - h * 0.52);
      g.quadraticCurveTo(cx + side * w * 0.36, by - h * 0.58, cx + side * w * 0.2, by - h * 0.55);
      g.lineTo(cx + side * w * 0.21, by - h * 0.5);
      g.quadraticCurveTo(cx + side * w * 0.35, by - h * 0.5, cx + side * w * 0.46, by - h * 0.44);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
}
