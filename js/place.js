// Where am I: reverse geocoding (towns / counties / states visited),
// current weather (Open-Meteo) and sunrise/sunset (computed locally).
import { bus, ls, distance, fetchJSON } from './util.js';

const WX = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Drizzle'],
  56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'], 61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'],
  65: ['🌧️', 'Heavy rain'], 66: ['🧊', 'Freezing rain'], 67: ['🧊', 'Freezing rain'], 71: ['🌨️', 'Light snow'],
  73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'],
  82: ['⛈️', 'Violent showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️', 'Thunderstorm + hail'], 99: ['⛈️', 'Thunderstorm + hail'],
};

export class Place {
  constructor() {
    this.info = null;
    this.weather = null;
    this.lastGeo = null;
    this.lastWx = null;
    this.busy = false;
    this.regions = ls.get('regions', { towns: {}, counties: {}, states: {} });
  }

  onFix(fix) {
    const now = Date.now();
    const lg = this.lastGeo;
    if (!this.busy && (!lg || (distance(lg.lat, lg.lon, fix.lat, fix.lon) > 1200 && now - lg.t > 20000) || now - lg.t > 5 * 60000)) {
      this.lastGeo = { lat: fix.lat, lon: fix.lon, t: now };
      this.geocode(fix.lat, fix.lon);
    }
    const lw = this.lastWx;
    if (!lw || now - lw.t > 10 * 60000 || distance(lw.lat, lw.lon, fix.lat, fix.lon) > 15000) {
      this.lastWx = { lat: fix.lat, lon: fix.lon, t: now };
      this.fetchWeather(fix.lat, fix.lon);
    }
    this.sun = sunTimes(new Date(), fix.lat, fix.lon);
  }

  async geocode(lat, lon) {
    this.busy = true;
    try {
      let info = null;
      try {
        const j = await fetchJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
        const admin = j.localityInfo?.administrative || [];
        const county = admin.find((a) => a.adminLevel === 6)?.name || admin.find((a) => /county|parish|borough/i.test(a.description || a.name))?.name;
        info = { town: j.city || j.locality || '', county: county || '', state: j.principalSubdivision || '', country: j.countryName || '' };
      } catch {
        const j = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=12`);
        const a = j.address || {};
        info = { town: a.city || a.town || a.village || a.hamlet || a.suburb || '', county: a.county || '', state: a.state || '', country: a.country || '' };
      }
      this.info = info;
      this.track('towns', info.town && `${info.town}, ${info.state}`, '🏘️', 'New town');
      this.track('counties', info.county && `${info.county}, ${info.state}`, '🗺️', 'New county');
      this.track('states', info.state, '🏳️', 'New state');
      ls.set('regions', this.regions);
      bus.emit('place', info);
    } catch (e) {
      bus.emit('net-error', { source: 'Geocoder', message: e.message });
      this.lastGeo.t = Date.now() - 4 * 60000; // retry soon
    } finally {
      this.busy = false;
    }
  }

  track(kind, name, icon, label) {
    if (!name) return;
    if (!this.regions[kind][name]) {
      const first = Object.keys(this.regions[kind]).length === 0;
      this.regions[kind][name] = Date.now();
      if (!first || kind === 'towns') bus.emit('region-new', { kind, name, icon, label });
    }
  }

  async fetchWeather(lat, lon) {
    try {
      const j = await fetchJSON(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph`
      );
      const c = j.current;
      const [icon, label] = WX[c.weather_code] || ['🌡️', ''];
      this.weather = { tempF: c.temperature_2m, icon: c.is_day ? icon : icon.replace('☀️', '🌙').replace('🌤️', '🌙'), label, windMph: c.wind_speed_10m, code: c.weather_code };
      bus.emit('weather', this.weather);
    } catch (e) {
      this.lastWx.t = Date.now() - 8 * 60000;
    }
  }
}

// NOAA-style sunrise/sunset approximation (accurate to ~1-2 minutes).
export function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const J1970 = 2440588, J2000 = 2451545;
  const toJulian = (d) => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const d = toJulian(date) - J2000;
  const lw = rad * -lon;
  const phi = rad * lat;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const hAt = (h) => {
    const w = Math.acos((Math.sin(h * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    return [fromJulian(Jnoon - (w / (2 * Math.PI))), fromJulian(Jnoon + w / (2 * Math.PI))];
  };
  const [sunrise, sunset] = hAt(-0.833);
  const [, goldenStart] = hAt(6);
  const [goldenEnd] = hAt(6);
  return { sunrise, sunset, goldenStart, goldenEnd };
}
