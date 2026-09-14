// Trip recording: detects drive start/stop, records a compact track,
// and keeps lifetime stats + daily streaks.
import { bus, idb, ls, distance, dayKey } from './util.js';

const PARK_MS = 3 * 60000; // stationary this long ends a trip
const MIN_TRIP_M = 400;

export class Trips {
  constructor() {
    this.current = null;
    this.trips = [];
    this.moving = false;
    this.stillSince = null;
    this.movingHits = 0;
    this.lastSave = 0;
    this.lifetime = ls.get('lifetime', { meters: 0, ms: 0, trips: 0, bestScore: 0, spills: 0 });
    this.days = ls.get('days', []);
  }

  async load() {
    this.trips = await idb.get('trips', []);
    const cur = await idb.get('tripCurrent', null);
    // Resume a trip interrupted by a page reload within 10 minutes;
    // otherwise the browser was closed mid-trip, so save what was recorded.
    if (cur && Date.now() - cur.lastT < 10 * 60000) this.current = cur;
    else if (cur) {
      this.current = cur;
      await this.end();
    }
    bus.on('glass', (g) => {
      if (this.current) {
        this.current.score = g.score;
        this.current.spills = g.spills;
        this.current.peakG = Math.max(this.current.peakG || 0, g.peakG);
      }
    });
    bus.on('collect', ({ place, points }) => {
      if (!this.current) return;
      this.current.places.push(place.id);
      this.current.xp += points;
    });
    bus.on('fog', ({ added }) => this.current && (this.current.newCells += added));
    bus.on('region-new', (r) => this.current && this.current.regions.push(r.name));
    bus.on('alert-ahead', () => this.current && (this.current.alerts = (this.current.alerts || 0) + 1));
  }

  onFix(fix) {
    const now = fix.t;
    // Motion state with hysteresis
    if (fix.speed > 3.5) {
      this.movingHits++;
      this.stillSince = null;
      if (!this.moving && this.movingHits >= 2) this.setMoving(true);
    } else {
      this.movingHits = 0;
      if (fix.speed < 1) {
        this.stillSince ??= now;
        if (this.moving && now - this.stillSince > 45000) this.setMoving(false);
      }
    }

    if (!this.current && this.moving) this.start(fix);
    const c = this.current;
    if (!c) return;

    const last = c.points.at(-1);
    const d = last ? distance(last[0], last[1], fix.lat, fix.lon) : 0;
    if (!last || (d > 12 && fix.acc < 50 && d < 2000)) {
      if (last) c.meters += d;
      c.points.push([+fix.lat.toFixed(6), +fix.lon.toFixed(6), Math.round((now - c.start) / 1000), Math.round(fix.speed)]);
      c.maxSpeed = Math.max(c.maxSpeed, fix.speed);
      bus.emit('trail', c.points);
    }
    c.lastT = now;
    if (now - this.lastSave > 20000) {
      this.lastSave = now;
      idb.set('tripCurrent', c);
    }
    if (this.stillSince && now - this.stillSince > PARK_MS) this.end();
  }

  setMoving(m) {
    this.moving = m;
    bus.emit('motion', { moving: m });
  }

  start(fix) {
    this.current = {
      id: Date.now(), start: fix.t, lastT: fix.t, points: [], meters: 0, maxSpeed: 0,
      places: [], xp: 0, newCells: 0, regions: [], score: 100, spills: 0, peakG: 0, sim: fix.source === 'sim',
    };
    bus.emit('trip-start', this.current);
  }

  async end() {
    const c = this.current;
    this.current = null;
    idb.set('tripCurrent', null);
    if (!c || c.meters < MIN_TRIP_M) {
      bus.emit('trip-end', null);
      return;
    }
    c.end = c.lastT;
    this.trips.unshift(c);
    if (this.trips.length > 300) this.trips.length = 300;
    await idb.set('trips', this.trips);
    const L = this.lifetime;
    L.meters += c.meters;
    L.ms += c.end - c.start;
    L.trips++;
    L.spills += c.spills;
    if (c.meters > 3000) L.bestScore = Math.max(L.bestScore, c.score);
    ls.set('lifetime', L);
    const dk = dayKey(c.start);
    if (!this.days.includes(dk)) {
      this.days.push(dk);
      ls.set('days', this.days);
    }
    bus.emit('trip-end', c);
  }

  streak() {
    const set = new Set(this.days);
    let n = 0;
    const d = new Date();
    if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (set.has(dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  since(ms) {
    const from = Date.now() - ms;
    return this.trips.filter((t) => t.start >= from);
  }
}
