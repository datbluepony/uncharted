// Simulated drive: follows a real road route (OSRM demo server) with
// realistic acceleration, braking for turns and the occasional hard stop.
import { bus, distance, bearing, angleDiff, offset, fetchJSON, clamp } from './util.js';

// Fallback route through Boston → Cambridge (rich Wikipedia coverage)
const FALLBACK = [
  [42.3522, -71.0552], [42.3559, -71.0605], [42.3564, -71.0621], [42.3553, -71.0656], [42.3541, -71.0707],
  [42.3530, -71.0770], [42.3508, -71.0810], [42.3491, -71.0870], [42.3480, -71.0930], [42.3527, -71.0917],
  [42.3553, -71.0917], [42.3601, -71.0942], [42.3653, -71.1036], [42.3695, -71.1107], [42.3736, -71.1190],
  [42.3770, -71.1167], [42.3818, -71.1128], [42.3870, -71.1000], [42.3796, -71.0913], [42.3740, -71.0770],
  [42.3697, -71.0632], [42.3651, -71.0584], [42.3600, -71.0560], [42.3522, -71.0552],
];

export class SimSource {
  constructor() {
    this.route = [];
    this.idx = 0;
    this.pos = null;
    this.speed = 0;
    this.timer = null;
    this.t = Date.now();
    this.brakeUntil = 0;
  }

  async start(origin) {
    bus.emit('gps', { state: 'ok', message: 'Simulated' });
    this.route = await this.buildRoute(origin);
    this.idx = 0;
    this.pos = { lat: this.route[0][0], lon: this.route[0][1] };
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
    return true;
  }

  stop() {
    clearInterval(this.timer);
  }

  async buildRoute(origin) {
    if (!origin) return densify(FALLBACK);
    try {
      const dest = offset(origin[0], origin[1], 9000, Math.random() * 360);
      const back = offset(origin[0], origin[1], 3000, Math.random() * 360);
      const coords = [origin, dest, back].map(([la, lo]) => `${lo.toFixed(5)},${la.toFixed(5)}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      const j = await fetchJSON(url, { timeout: 8000 });
      const pts = j.routes?.[0]?.geometry?.coordinates;
      if (pts?.length > 10) return densify(pts.map(([lo, la]) => [la, lo]));
    } catch {}
    return densify(FALLBACK);
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.t) / 1000 || 1;
    this.t = now;

    // Look ahead ~120 m for the sharpest turn to set a target speed.
    let sharp = 0;
    let acc = 0;
    for (let i = this.idx + 1; i < this.route.length - 1 && acc < 120; i++) {
      const a = this.route[i - 1], b = this.route[i], c = this.route[i + 1];
      acc += distance(a[0], a[1], b[0], b[1]);
      sharp = Math.max(sharp, Math.abs(angleDiff(bearing(a[0], a[1], b[0], b[1]), bearing(b[0], b[1], c[0], c[1]))));
    }
    let target = sharp > 60 ? 7 : sharp > 30 ? 11 : sharp > 15 ? 15 : 20;
    if (now < this.brakeUntil) target = 0;
    else if (Math.random() < 0.012) this.brakeUntil = now + 4000 + Math.random() * 6000; // red light

    const accel = target > this.speed ? 1.6 + Math.random() : -(2.2 + Math.random() * 1.8);
    const next = this.speed + accel * dt;
    this.speed = clamp(accel > 0 ? Math.min(next, target) : Math.max(next, target), 0, 40);

    // Advance along the polyline.
    let move = this.speed * dt;
    while (move > 0 && this.idx < this.route.length - 1) {
      const nxt = this.route[this.idx + 1];
      const d = distance(this.pos.lat, this.pos.lon, nxt[0], nxt[1]);
      if (d <= move) {
        move -= d;
        this.idx++;
        this.pos = { lat: nxt[0], lon: nxt[1] };
      } else {
        const f = move / d;
        this.pos = { lat: this.pos.lat + (nxt[0] - this.pos.lat) * f, lon: this.pos.lon + (nxt[1] - this.pos.lon) * f };
        move = 0;
      }
    }
    if (this.idx >= this.route.length - 1) {
      this.route.reverse();
      this.idx = 0;
    }
    const nxt = this.route[Math.min(this.idx + 1, this.route.length - 1)];
    const heading = bearing(this.pos.lat, this.pos.lon, nxt[0], nxt[1]);

    bus.emit('fix', { lat: this.pos.lat, lon: this.pos.lon, acc: 5, speed: this.speed, heading, t: now, source: 'sim', rate: 1 });
  }
}

// Insert points so no segment exceeds 25 m (smooth turn detection).
function densify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const d = distance(a[0], a[1], b[0], b[1]);
    const n = Math.floor(d / 25);
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / (n + 1), a[1] + ((b[1] - a[1]) * k) / (n + 1)]);
    out.push(b);
  }
  return out;
}
