// Real GPS location source. Normalizes fixes and fills in speed/heading
// when the browser doesn't provide them.
import { bus, distance, bearing } from './util.js';

export class GpsSource {
  constructor() {
    this.prev = null;
    this.lastHeading = null;
    this.watchId = null;
    this.lastFixAt = 0;
    this.fixTimes = [];
    this.pollTimer = null;
  }

  start() {
    if (!('geolocation' in navigator)) {
      bus.emit('gps', { state: 'bad', message: 'This browser has no location support' });
      return false;
    }
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onPos(p),
      (e) => bus.emit('gps', { state: 'bad', message: e.message || 'Location unavailable' }),
      opts
    );
    // Some browsers throttle watchPosition; poll as a backup when fixes go quiet.
    this.pollTimer = setInterval(() => {
      const quiet = Date.now() - this.lastFixAt;
      if (quiet > 4000) {
        navigator.geolocation.getCurrentPosition((p) => this.onPos(p), () => {}, opts);
      }
      if (quiet > 15000 && this.lastFixAt) bus.emit('gps', { state: 'weak', message: 'GPS signal lost' });
    }, 2000);
    return true;
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    clearInterval(this.pollTimer);
  }

  onPos(p) {
    const t = p.timestamp || Date.now();
    if (this.prev && t <= this.prev.t) return; // duplicate from poll + watch
    const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
    let speed = p.coords.speed;
    let heading = p.coords.heading;
    let derived = false;

    if (this.prev) {
      const d = distance(this.prev.lat, this.prev.lon, lat, lon);
      const dt = (t - this.prev.t) / 1000;
      if ((speed == null || Number.isNaN(speed)) && dt > 0) {
        // Ignore movement inside the accuracy circle (parked GPS drift).
        speed = d < acc * 0.6 ? 0 : d / dt;
        derived = true;
      }
      if ((heading == null || Number.isNaN(heading)) && d > Math.max(4, acc * 0.5)) {
        heading = bearing(this.prev.lat, this.prev.lon, lat, lon);
      }
    }
    if (speed == null || Number.isNaN(speed)) speed = 0;
    // Heading is meaningless when stopped: hold the last good one.
    if (heading == null || Number.isNaN(heading) || speed < 1) heading = this.lastHeading;
    else this.lastHeading = heading;

    this.lastFixAt = Date.now();
    this.fixTimes.push(this.lastFixAt);
    if (this.fixTimes.length > 10) this.fixTimes.shift();

    const fix = { lat, lon, acc, speed, heading, t, source: 'gps', rate: this.rate(), derived };
    this.prev = fix;
    bus.emit('gps', { state: acc <= 30 ? 'ok' : 'weak', message: `±${Math.round(acc)} m` });
    bus.emit('fix', fix);
  }

  rate() {
    if (this.fixTimes.length < 2) return 0;
    const span = (this.fixTimes.at(-1) - this.fixTimes[0]) / 1000;
    return span > 0 ? (this.fixTimes.length - 1) / span : 0;
  }
}
