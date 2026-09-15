// MapLibre map: a restyled neon basemap with 3D buildings and an atmospheric
// horizon, heading-up follow camera, gradient light trail, place pins with
// floating "loot beacons" for nearby undiscovered places, road-alert markers,
// Superchargers, the car icon with a radar sweep, XP bursts, and the fog.
/* global maplibregl */
import { bus, settings, clamp, distance, fmtDist } from './util.js';

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
const CAT_ICONS = { history: '🏛️', nature: '🌲', town: '🏘️', culture: '🎭', structure: '🌉', oddity: '👻' };

export class MapView {
  constructor(fog) {
    this.fog = fog;
    this.follow = true;
    this.fix = null;
    this.carEl = document.getElementById('car');
    this.carSvg = this.carEl.querySelector('svg');
    this.radar = this.carEl.querySelector('.car-radar');
    this.trail = [];
    this.hazardMarkers = new Map();
    this.beacons = new Map();
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

  // Neon night look on top of CARTO Dark Matter
  restyle() {
    const map = this.map;
    const has = (id) => !!map.getLayer(id);
    const paint = (id, prop, val) => { if (has(id)) try { map.setPaintProperty(id, prop, val); } catch {} };
    paint('background', 'background-color', '#03050a');
    paint('water', 'fill-color', '#06182b');
    paint('water_shadow', 'fill-color', '#041222');
    for (const id of ['park_national_park', 'park_nature_reserve']) paint(id, 'fill-color', '#06140d');
    for (const id of ['landcover', 'landuse', 'landuse_residential']) paint(id, 'fill-opacity', 0.4);

    const roadColor = [['mot', '#46b8ff'], ['trunk', '#3a9fe8'], ['pri', '#2d6fa8'], ['sec', '#23507c'], ['minor', '#1a2a3e'], ['service', '#141f2e']];
    for (const layer of map.getStyle().layers) {
      const id = layer.id;
      if (!/^(road|bridge|tunnel)_/.test(id) || layer.type !== 'line') continue;
      const hit = roadColor.find(([k]) => id.includes(`_${k}_`));
      if (id.includes('_case')) paint(id, 'line-color', '#02040a');
      else if (hit) paint(id, 'line-color', hit[1]);
    }
    for (const id of ['place_town', 'place_villages', 'place_suburbs', 'place_hamlet', 'place_city_r6', 'place_city_r5']) paint(id, 'text-color', '#9fb8d6');
    for (const id of ['roadname_major', 'roadname_pri', 'roadname_sec', 'roadname_minor']) paint(id, 'text-color', '#6f8aa8');

    const firstRoad = map.getStyle().layers.find((l) => /^(tunnel|road)_/.test(l.id))?.id;
    if (map.getSource('carto') && map.getStyle().sources.carto.type === 'vector') {
      // Soft glow under highways
      map.addLayer({
        id: 'road-glow', type: 'line', source: 'carto', 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'class'], 'motorway', '#3fb6ff', 'trunk', '#3fb6ff', '#2f7fd0'],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 3, 14, 16, 18, 60],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 8, 3, 18, 30],
          'line-opacity': 0.18,
        },
      }, firstRoad);
      // 3D glass buildings
      for (const id of ['building', 'building-top']) if (has(id)) map.setLayoutProperty(id, 'visibility', 'none');
      const h = ['coalesce', ['get', 'render_height'], ['get', 'height'], 9];
      map.addLayer({
        id: 'buildings-3d', type: 'fill-extrusion', source: 'carto', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], h, 0, '#0b1320', 25, '#122038', 80, '#1b3152'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, h],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-vertical-gradient': true,
        },
      });
    }
    try {
      map.setSky({
        'sky-color': '#02040a', 'sky-horizon-blend': 0.55, 'horizon-color': '#0e2c4d',
        'horizon-fog-blend': 0.75, 'fog-color': '#03060c', 'fog-ground-blend': 0.55, 'atmosphere-blend': 0,
      });
    } catch {}
  }

  addLayers() {
    const map = this.map;
    const empty = { type: 'FeatureCollection', features: [] };
    try {
      this.restyle();
    } catch (e) {
      console.warn('restyle', e);
    }
    this.fog.attach(map); // fog above the basemap, below our layers
    map.addSource('history', { type: 'geojson', data: empty });
    map.addSource('trail', { type: 'geojson', data: empty, lineMetrics: true });
    map.addSource('places', { type: 'geojson', data: empty });

    map.addLayer({ id: 'history-line', type: 'line', source: 'history',
      paint: { 'line-color': '#3fb6ff', 'line-width': 3, 'line-opacity': 0.22 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    // Light trail: fades in from the tail, white-hot at the car
    map.addLayer({ id: 'trail-glow', type: 'line', source: 'trail',
      paint: { 'line-width': 22, 'line-blur': 14,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(63,182,255,0)', 0.5, 'rgba(63,182,255,0.25)', 1, 'rgba(124,247,212,0.7)'] },
      layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'trail-core', type: 'line', source: 'trail',
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 6],
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(63,182,255,0.05)', 0.6, 'rgba(90,200,255,0.8)', 1, '#e8fbff'] },
      layout: { 'line-cap': 'round', 'line-join': 'round' } });

    const color = ['match', ['get', 'cat'], ...Object.entries(CAT_COLORS).flat(), '#ffffff'];
    map.addLayer({ id: 'places-glow', type: 'circle', source: 'places',
      paint: { 'circle-color': color, 'circle-radius': ['case', ['get', 'got'], 5, 15], 'circle-blur': 1, 'circle-opacity': ['case', ['get', 'got'], 0.2, 0.6] } });
    map.addLayer({ id: 'places-dot', type: 'circle', source: 'places',
      paint: { 'circle-color': color, 'circle-radius': ['case', ['get', 'got'], 3.5, 6.5], 'circle-stroke-color': '#fff',
        'circle-stroke-width': ['case', ['get', 'got'], 0, 1.8], 'circle-opacity': ['case', ['get', 'got'], 0.5, 1] } });
    map.addLayer({ id: 'places-label', type: 'symbol', source: 'places', minzoom: 14.5, filter: ['!', ['get', 'got']],
      layout: { 'text-field': ['get', 'title'], 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 10,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'], 'text-optional': true },
      paint: { 'text-color': '#dfe8f5', 'text-halo-color': '#03050a', 'text-halo-width': 1.6 } });

    map.on('click', 'places-dot', (e) => {
      const f = e.features?.[0];
      if (f) bus.emit('place-click', f.properties.id);
    });
    map.on('mouseenter', 'places-dot', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'places-dot', () => (map.getCanvas().style.cursor = ''));

    // Superchargers (below the place pins)
    map.addSource('sc', { type: 'geojson', data: empty });
    map.addLayer({ id: 'sc-glow', type: 'circle', source: 'sc', minzoom: 10,
      paint: { 'circle-color': '#ff4d5e', 'circle-radius': 16, 'circle-blur': 1, 'circle-opacity': 0.45 } }, 'places-glow');
    map.addLayer({ id: 'sc-dot', type: 'circle', source: 'sc', minzoom: 5,
      paint: { 'circle-color': '#ff4d5e', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 7],
        'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0, 12, 2] } }, 'places-glow');
    map.addLayer({ id: 'sc-label', type: 'symbol', source: 'sc', minzoom: 12.5,
      layout: { 'text-field': ['concat', ['get', 'name'], ' Supercharger'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top',
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'], 'text-optional': true },
      paint: { 'text-color': '#ffb3ba', 'text-halo-color': '#03050a', 'text-halo-width': 1.5 } }, 'places-glow');
    map.on('click', 'sc-dot', (e) => {
      const f = e.features?.[0];
      if (f) bus.emit('sc-click', { ...f.properties, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
    });

    this.ready = true;
    this.setTrail(this.trail);
    if (this.pendingPlaces) this.setPlaces(this.pendingPlaces);
    if (this.pendingHistory) this.setHistory(this.pendingHistory);
    if (this.pendingSC) this.setSuperchargers(this.pendingSC);
  }

  setSuperchargers(sites) {
    this.pendingSC = sites;
    if (!this.ready) return;
    this.map.getSource('sc').setData({
      type: 'FeatureCollection',
      features: sites.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { name: s.name, stalls: s.stalls, kw: s.kw } })),
    });
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
      const zoom = clamp(17.2 - fix.speed * 0.085, 14.3, 17.2);
      const camera = {
        center: [fix.lon, fix.lat],
        bearing: fix.heading ?? this.map.getBearing(),
        zoom,
        pitch: settings.get().pitch,
        padding: { top: h * 0.38, bottom: 0, left: 0, right: 0 },
      };
      if (this.covered) this.map.jumpTo(camera);
      else this.map.easeTo({ ...camera, duration: immediate ? 600 : 950, easing: (t) => t });
    }
    this.carEl.classList.toggle('moving', fix.speed > 2);
    this.onRender();
  }

  onRender() {
    if (!this.map || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.placeCar();
    });
  }

  placeCar() {
    if (!this.fix) {
      this.carEl.style.opacity = 0;
      return;
    }
    const p = this.map.project([this.fix.lon, this.fix.lat]);
    this.carEl.style.opacity = 1;
    this.carEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const rot = (this.fix.heading ?? 0) - this.map.getBearing();
    const squash = 1 - (this.map.getPitch() / 90) * 0.45;
    this.carSvg.style.transform = `scaleY(${squash}) rotate(${rot}deg)`;
    if (this.radar) this.radar.style.transform = `translate(-50%, -50%) scaleY(${squash})`;
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

  // Floating beacons over the nearest undiscovered places
  updateBeacons(fix, places) {
    if (!this.map || !fix) return;
    const near = places
      .filter((p) => !p.got && p.lat != null)
      .map((p) => ({ p, d: distance(fix.lat, fix.lon, p.lat, p.lon) }))
      .filter((x) => x.d < 2500)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    const keep = new Set();
    for (const { p, d } of near) {
      keep.add(p.id);
      let m = this.beacons.get(p.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = `beacon rar-${p.rarity || 'common'}`;
        el.style.setProperty('--c', CAT_COLORS[p.cat] || '#fff');
        el.innerHTML = `<div class="beam"></div><div class="gem"><span>${CAT_ICONS[p.cat] || '✦'}</span></div><div class="bd"></div>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          bus.emit('place-click', p.id);
        });
        m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(this.map);
        this.beacons.set(p.id, m);
      }
      m.getElement().querySelector('.bd').textContent = fmtDist(d);
    }
    for (const [id, m] of this.beacons) {
      if (!keep.has(id)) {
        m.getElement().classList.add('bye');
        setTimeout(() => m.remove(), 400);
        this.beacons.delete(id);
      }
    }
  }

  removeBeacon(id) {
    const m = this.beacons.get(id);
    if (!m) return;
    m.remove();
    this.beacons.delete(id);
  }

  // Road alerts
  setHazards(list, KINDS) {
    const seen = new Set();
    for (const h of list) {
      seen.add(h.id);
      if (this.hazardMarkers.has(h.id)) continue;
      const k = KINDS[h.kind];
      const el = document.createElement('div');
      el.className = `hz hz-${h.kind}`;
      el.style.setProperty('--c', k.color);
      el.innerHTML = `<i></i><i></i><b>${k.icon}</b>`;
      el.title = h.title;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        bus.emit('hazard-click', h);
      });
      this.hazardMarkers.set(h.id, new maplibregl.Marker({ element: el }).setLngLat([h.lon, h.lat]).addTo(this.map));
    }
    for (const [id, m] of this.hazardMarkers) {
      if (!seen.has(id)) {
        m.remove();
        this.hazardMarkers.delete(id);
      }
    }
  }

  // "+25 XP" burst with particles at a place
  burst(lat, lon, text, color = '#ffd66b') {
    if (!this.map) return;
    const p = this.map.project([lon, lat]);
    const el = document.createElement('div');
    el.className = 'xp-burst';
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.setProperty('--c', color);
    el.innerHTML = `<b>${text}</b>${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg;--d:${50 + (i % 3) * 22}px"></i>`).join('')}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  flyTo(lat, lon, zoom = 16) {
    this.setFollow(false);
    this.map.flyTo({ center: [lon, lat], zoom, pitch: 45 });
  }
}
