// MapLibre map: heading-up follow camera, glowing trail, place pins,
// alert markers, car icon and the fog overlay.
/* global maplibregl */
import { bus, settings, clamp } from './util.js';

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const RASTER_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tileSize: 256,
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`),
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

export const CAT_COLORS = {
  history: '#ffb547', nature: '#5de38b', town: '#3fb6ff', culture: '#c38bff', structure: '#ff7ab8', oddity: '#7cf7d4',
};

export class MapView {
  constructor(fog) {
    this.fog = fog;
    this.follow = true;
    this.fix = null;
    this.carEl = document.getElementById('car');
    this.carSvg = this.carEl.querySelector('svg');
    this.trail = [];
    this.alertMarkers = new Map();
    this.ready = false;
    this.pendingPlaces = null;
  }

  init(center = [-71.0589, 42.3601]) {
    const map = (this.map = new maplibregl.Map({
      container: 'map',
      style: DARK_STYLE,
      center,
      zoom: 15.5,
      pitch: settings.get().pitch,
      attributionControl: { compact: true },
      maxPitch: 70,
      fadeDuration: 0,
    }));
    let styleFailed = false;
    map.on('error', (e) => {
      if (!this.ready && !styleFailed && String(e?.error?.message || '').match(/style|fetch|load/i)) {
        styleFailed = true;
        map.setStyle(RASTER_STYLE);
      }
    });
    map.on('style.load', () => this.addLayers());
    map.on('render', () => this.onRender());
    const stopFollow = (e) => {
      if (e.originalEvent && this.follow) this.setFollow(false);
    };
    map.on('dragstart', stopFollow);
    map.on('rotatestart', stopFollow);
    map.on('pitchstart', stopFollow);
    addEventListener('resize', () => this.onRender());
    return map;
  }

  addLayers() {
    const map = this.map;
    const empty = { type: 'FeatureCollection', features: [] };
    this.fog.attach(map); // fog sits above the basemap, below our layers
    map.addSource('history', { type: 'geojson', data: empty });
    map.addSource('trail', { type: 'geojson', data: empty });
    map.addSource('places', { type: 'geojson', data: empty });

    map.addLayer({ id: 'history-line', type: 'line', source: 'history',
      paint: { 'line-color': '#3fb6ff', 'line-width': 3, 'line-opacity': 0.28 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'trail-glow', type: 'line', source: 'trail',
      paint: { 'line-color': '#3fb6ff', 'line-width': 18, 'line-blur': 12, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'trail-core', type: 'line', source: 'trail',
      paint: { 'line-color': '#b8f0ff', 'line-width': 4.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });

    const color = ['match', ['get', 'cat'], ...Object.entries(CAT_COLORS).flat(), '#ffffff'];
    map.addLayer({ id: 'places-glow', type: 'circle', source: 'places',
      paint: { 'circle-color': color, 'circle-radius': ['case', ['get', 'got'], 6, 16], 'circle-blur': 1, 'circle-opacity': ['case', ['get', 'got'], 0.25, 0.7] } });
    map.addLayer({ id: 'places-dot', type: 'circle', source: 'places',
      paint: { 'circle-color': color, 'circle-radius': ['case', ['get', 'got'], 4, 7], 'circle-stroke-color': '#fff',
        'circle-stroke-width': ['case', ['get', 'got'], 0, 2], 'circle-opacity': ['case', ['get', 'got'], 0.6, 1] } });
    map.addLayer({ id: 'places-label', type: 'symbol', source: 'places', minzoom: 14.5, filter: ['!', ['get', 'got']],
      layout: { 'text-field': ['get', 'title'], 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 10,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'], 'text-optional': true },
      paint: { 'text-color': '#dfe8f5', 'text-halo-color': '#05070a', 'text-halo-width': 1.6 } });

    map.on('click', 'places-dot', (e) => {
      const f = e.features?.[0];
      if (f) bus.emit('place-click', f.properties.id);
    });
    map.on('mouseenter', 'places-dot', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'places-dot', () => (map.getCanvas().style.cursor = ''));

    this.ready = true;
    this.setTrail(this.trail);
    if (this.pendingPlaces) this.setPlaces(this.pendingPlaces);
    if (this.pendingHistory) this.setHistory(this.pendingHistory);
  }

  setFollow(on) {
    this.follow = on;
    bus.emit('follow', on);
    if (on && this.fix) this.update(this.fix, true);
  }

  update(fix, immediate = false) {
    this.fix = fix;
    if (!this.map) return;
    if (this.follow) {
      const h = innerHeight;
      // Zoom out as speed increases so you see further ahead.
      const zoom = clamp(17.2 - fix.speed * 0.085, 14.3, 17.2);
      const camera = {
        center: [fix.lon, fix.lat],
        bearing: fix.heading ?? this.map.getBearing(),
        zoom,
        pitch: settings.get().pitch,
        padding: { top: h * 0.38, bottom: 0, left: 0, right: 0 },
      };
      // When a full-screen section covers the map, jump instead of animating
      // so the GPU isn't rendering 60 fps behind it.
      if (this.covered) this.map.jumpTo(camera);
      else this.map.easeTo({ ...camera, duration: immediate ? 600 : 950, easing: (t) => t });
    }
    this.carEl.classList.toggle('stale', false);
    this.onRender();
  }

  onRender() {
    if (!this.map) return;
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.placeCar();
      });
    }
  }

  placeCar() {
    if (!this.fix) {
      this.carEl.style.opacity = 0;
      return;
    }
    const p = this.map.project([this.fix.lon, this.fix.lat]);
    this.carEl.style.opacity = 1;
    this.carEl.style.left = `${p.x}px`;
    this.carEl.style.top = `${p.y}px`;
    const rot = (this.fix.heading ?? 0) - this.map.getBearing();
    // Squash vertically to fake the pitch so the arrow lies on the road.
    const squash = 1 - (this.map.getPitch() / 90) * 0.45;
    this.carSvg.style.transform = `scaleY(${squash}) rotate(${rot}deg)`;
  }

  setTrail(points) {
    this.trail = points;
    if (!this.ready) return;
    this.map.getSource('trail').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points.length > 1 ? points.map((p) => [p[1], p[0]]) : [] },
    });
  }

  setHistory(lines) {
    this.pendingHistory = lines;
    if (!this.ready) return;
    this.map.getSource('history').setData({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map((p) => [p[1], p[0]])) },
    });
  }

  setPlaces(places) {
    this.pendingPlaces = places;
    if (!this.ready) return;
    this.map.getSource('places').setData({
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, cat: p.cat, title: p.title, got: !!p.got },
      })),
    });
  }

  setAlerts(alerts) {
    const seen = new Set();
    for (const a of alerts) {
      seen.add(a.id);
      if (this.alertMarkers.has(a.id)) continue;
      const el = document.createElement('div');
      el.className = 'alert-mk';
      el.textContent = a.icon;
      el.title = a.label;
      this.alertMarkers.set(a.id, new maplibregl.Marker({ element: el }).setLngLat([a.lon, a.lat]).addTo(this.map));
    }
    for (const [id, m] of this.alertMarkers) {
      if (!seen.has(id)) {
        m.remove();
        this.alertMarkers.delete(id);
      }
    }
  }

  flyTo(lat, lon, zoom = 16) {
    this.setFollow(false);
    this.map.flyTo({ center: [lon, lat], zoom, pitch: 40 });
  }
}
