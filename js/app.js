// Uncharted: wires location → fog, map, storyteller, glass, trips, alerts,
// car data, sound and UI.
import { bus, ls, settings, fmtSpeed, fmtDist, escapeHtml } from './util.js';
import { GpsSource } from './geo.js';
import { SimSource } from './sim.js';
import { Fog } from './fog.js';
import { MapView } from './map.js';
import { Glass } from './glass.js';
import { speech } from './speech.js';
import { audio } from './audio.js';
import { Stories, CATS, RARITY } from './stories.js';
import { Place } from './place.js';
import { Trips } from './trips.js';
import { Alerts } from './waze.js';
import { Quests } from './quests.js';
import { renderQuiz } from './quiz.js';
import { renderCollection, renderQuests, renderTrips, renderSettings, disposeRecap } from './sheets.js';
import { Intro } from './intro.js';
import { Detail } from './detail.js';
import { detectCar, Connectivity, Elevation, Energy, Superchargers } from './tesla.js';
import { CarView } from './carview.js';
import { SkyTab } from './sky/skytab.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const intro = new Intro($('introCanvas'));
const car = detectCar();
const fog = new Fog();
const mapView = new MapView(fog);
const glass = new Glass($('glass'));
const stories = new Stories();
const place = new Place();
const trips = new Trips();
const alerts = new Alerts();
const quests = new Quests();
const conn = new Connectivity();
const elevation = new Elevation();
const energy = new Energy();
const superchargers = new Superchargers();

let fix = null;
let gpsState = { state: 'none', message: 'Waiting' };
let source = null;
let passenger = false;
let activeTab = 'drive';
let lastEnergy = null;
const session = { start: Date.now(), meters: 0, top: 0 };

const detail = new Detail({
  stories,
  speech,
  getFix: () => fix,
  isLocked: () => trips.moving && !passenger,
  unlockPassenger: () => (passenger = true),
  showOnMap: (p) => {
    closeSheet();
    mapView.flyTo(p.lat, p.lon, 16.5);
  },
});
const openDetail = (id) => detail.openPlace({ id });

const deps = {
  trips, stories, fog, place, alerts, mapView, car, conn, elevation, superchargers, glass, session, openDetail,
  getFix: () => fix,
  getGps: () => gpsState,
  getEnergy: () => lastEnergy,
};
const carView = new CarView(deps);
const skyTab = new SkyTab($('skyView'), {
  getFix: () => fix,
  detail,
  audio,
  isLocked: () => trips.moving && !passenger,
  unlockPassenger: () => (passenger = true),
  onClose: () => closeSky(),
  metric: () => settings.get().units === 'metric',
});
function openSky() {
  closeSheet();
  alerts.toggle(false);
  setDock('sky');
  mapView.covered = true;
  skyTab.show();
}
function closeSky() {
  skyTab.hide();
  mapView.covered = false;
  setDock('drive');
}

// ---------- UI helpers ----------
function toast(html, cls = '', ms = 5000) {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.innerHTML = html;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
  return el;
}

let storyTimer = null;
let storyPlace = null;
function showStory(p, d) {
  storyPlace = p;
  const card = $('story');
  card.classList.remove('hidden', 'out');
  void card.offsetWidth; // restart animation
  $('storyImg').style.backgroundImage = p.thumb ? `url("${p.thumb}")` : '';
  $('storyImg').classList.toggle('empty', !p.thumb);
  $('storyCat').textContent = `${CATS[p.cat].icon} ${CATS[p.cat].label}${p.rarity !== 'common' ? ' · ' + p.rarity : ''}`;
  $('storyDist').textContent = d != null ? (d < 120 ? 'here' : fmtDist(d)) : 'collected';
  $('storyTitle').textContent = p.title;
  $('storyText').textContent = (p.extract.match(/[^.!?]+[.!?]+(\s|$)/g) || [p.extract]).slice(0, 3).join(' ');
  const timer = $('storyTimer');
  timer.classList.remove('run');
  void timer.offsetWidth;
  timer.classList.add('run');
  clearTimeout(storyTimer);
  storyTimer = setTimeout(hideStory, 16000);
}
function hideStory() {
  const card = $('story');
  if (card.classList.contains('hidden')) return;
  card.classList.add('out');
  setTimeout(() => card.classList.add('hidden'), 450);
}
$('storyClose').onclick = (e) => {
  e.stopPropagation();
  hideStory();
};
$('story').onclick = () => {
  if (!storyPlace) return;
  clearTimeout(storyTimer);
  hideStory();
  openDetail(storyPlace.id);
};

function setDock(tab) {
  activeTab = tab;
  document.querySelectorAll('#dock [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

const SHEETS = {
  car: ['Your Model 3', (root) => carView.render(root)],
  collection: ['Collection', (root) => renderCollection(root, { stories, place, mapView, closeSheet, openDetail })],
  quests: ['Quests', (root) => renderQuests(root, { quests, deps })],
  trips: ['Trips', (root) => renderTrips(root, deps)],
  quiz: ['Road Quiz', (root) => renderQuiz(root, stories.collection, stories.list(), refreshQuests)],
  settings: ['Settings', (root) => renderSettings(root, deps)],
};
const LOCKED = new Set(['car', 'collection', 'quests', 'trips', 'quiz']);

function openSheet(tab) {
  alerts.toggle(false);
  setDock(tab);
  $('sheet').classList.remove('hidden');
  mapView.covered = true;
  $('sheetTitle').textContent = SHEETS[tab][0];
  renderSheetBody();
}
function renderSheetBody() {
  disposeRecap();
  carView.dispose();
  const locked = LOCKED.has(activeTab) && trips.moving && !passenger;
  $('sheetLock').classList.toggle('hidden', !locked);
  $('sheetBody').classList.toggle('hidden', locked);
  if (!locked) SHEETS[activeTab][1]($('sheetBody'));
  else $('sheetBody').innerHTML = '';
}
function closeSheet() {
  disposeRecap();
  carView.dispose();
  mapView.covered = false;
  $('sheet').classList.add('hidden');
  $('sheetBody').innerHTML = '';
  setDock(alerts.open ? 'waze' : 'drive');
}
$('sheetClose').onclick = closeSheet;
$('passengerBtn').onclick = () => {
  passenger = true;
  renderSheetBody();
};

document.querySelectorAll('#dock [data-tab]').forEach((b) => {
  b.onclick = () => {
    const tab = b.dataset.tab;
    if (detail.open) detail.close();
    if (tab === 'sky') return skyTab.open ? closeSky() : openSky();
    if (skyTab.open) {
      skyTab.hide();
      mapView.covered = false;
    }
    if (tab === 'drive') {
      closeSheet();
      alerts.toggle(false);
      setDock('drive');
      mapView.setFollow(true);
    } else if (tab === 'waze') {
      closeSheet();
      setDock(alerts.toggle() ? 'waze' : 'drive');
    } else if (activeTab === tab && !$('sheet').classList.contains('hidden')) {
      closeSheet();
    } else {
      openSheet(tab);
    }
  };
});
$('wazeClose').onclick = () => {
  alerts.toggle(false);
  setDock('drive');
};
$('voiceBtn').onclick = () => {
  const on = !settings.get().voice;
  settings.set({ voice: on });
  if (!on) speech.stop();
};
$('followBtn').onclick = () => mapView.setFollow(!mapView.follow);

function applySettings(s) {
  $('voiceBtn').classList.toggle('on', s.voice);
  $('glassBox').classList.toggle('hidden', !s.showGlass);
  $('speedUnit').textContent = s.units === 'metric' ? 'km/h' : 'mph';
  $('wazeFrame').classList.toggle('dark', s.wazeDark !== false);
  mapView.setPlaces(visiblePlaces());
  if (fix) mapView.update(fix, true);
}
const visiblePlaces = () => stories.list().filter((p) => settings.get().categories[p.cat]);

// ---------- Intro ----------
function renderIntro() {
  const h = new Date().getHours();
  const greet = h < 5 ? 'Late-night drive' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late-night drive';
  $('introGreet').textContent = `${greet}, Andrew & Jenna`;
  const L = trips.lifetime;
  const coll = Object.keys(stories.collection).length;
  let stats;
  try {
    const q = quests.evaluate(deps);
    const streak = trips.streak();
    stats = L.trips || coll || fog.cells.size
      ? [
          `<b>${fmtDist(L.meters)}</b> driven together`,
          `<b>${fog.areaKm2.toFixed(fog.areaKm2 < 10 ? 2 : 1)} km²</b> uncovered`,
          `<b>${coll}</b> places collected`,
          `Level <b>${q.level}</b> · ${q.title}`,
          streak > 1 ? `🔥 <b>${streak}</b>-day streak` : '',
        ]
      : ['Your first chapter starts here'];
  } catch {
    stats = ['Your first chapter starts here'];
  }
  $('introStats').innerHTML = stats.filter(Boolean).map((s) => `<div class="is">${s}</div>`).join('');
  $('introCar').innerHTML = car.isTesla
    ? `<span class="pulse-dot ok"></span> Model 3 connected · software ${escapeHtml(car.version)}`
    : `<span class="pulse-dot"></span> Preview mode · open in your Model 3 for live car details`;
}

// ---------- Clock, sun ----------
function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const s = place.sun;
  if (s && !isNaN(s.sunset)) {
    const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    let txt;
    if (now < s.sunrise) txt = `🌅 Sunrise ${t(s.sunrise)}`;
    else if (now < s.goldenEnd) txt = '✨ Golden hour';
    else if (now < s.goldenStart) txt = `🌇 Sunset ${t(s.sunset)}`;
    else if (now < s.sunset) txt = '✨ Golden hour';
    else txt = '🌙 Night';
    $('sun').textContent = txt;
  }
}
setInterval(tickClock, 10000);
tickClock();

// ---------- Quests ----------
function refreshQuests() {
  try {
    quests.evaluate(deps);
  } catch (e) {
    console.warn('quests', e);
  }
  if (activeTab === 'quests' && !$('sheet').classList.contains('hidden')) renderSheetBody();
}
setInterval(refreshQuests, 20000);

// ---------- Event wiring ----------
let lastPosSave = 0;
let newGroundTimer = null;
let prevFix = null;
bus.on('fix', (f) => {
  fix = f;
  if (f.t - lastPosSave > 30000) {
    lastPosSave = f.t;
    ls.set('lastPos', [f.lon, f.lat]);
  }
  if (prevFix && f.t - prevFix.t < 5000) session.meters += f.speed * ((f.t - prevFix.t) / 1000);
  prevFix = f;
  $('speedVal').textContent = fmtSpeed(f.speed);
  fog.reveal(f);
  mapView.update(f);
  glass.onFix(f);
  trips.onFix(f);
  stories.onFix(f);
  place.onFix(f);
  alerts.onFix(f);
  energy.onFix(f, place.weather?.tempF);
  elevation.onFix(f, f.altitude);
  superchargers.onFix(f);
  skyTab.onFix(f);
});

bus.on('gps', (g) => {
  gpsState = g;
  $('gpsDot').className = `dot ${g.state}`;
  $('gpsDot').title = g.message;
  $('car').classList.toggle('stale', g.state === 'bad');
  if (g.state === 'bad' && !fix) {
    $('placeName').textContent = 'Location unavailable';
    $('placeSub').textContent = g.message;
  }
});

bus.on('fog', ({ areaKm2 }) => {
  $('exploredVal').textContent = areaKm2 < 10 ? areaKm2.toFixed(2) : areaKm2.toFixed(1);
  if (trips.moving) {
    $('newRoad').classList.remove('hidden');
    clearTimeout(newGroundTimer);
    newGroundTimer = setTimeout(() => $('newRoad').classList.add('hidden'), 6000);
  }
});

bus.on('trail', (pts) => mapView.setTrail(pts));
bus.on('places', () => mapView.setPlaces(visiblePlaces()));
bus.on('alerts', (list) => mapView.setAlerts(list));
bus.on('follow', (on) => $('followBtn').classList.toggle('on', on));
bus.on('settings', applySettings);

bus.on('place', (info) => {
  $('placeName').textContent = info.town || info.county || info.state || 'Somewhere';
  $('placeSub').textContent = [info.county, info.state].filter(Boolean).join(', ');
});
bus.on('weather', (w) => {
  $('weather').textContent = `${w.icon} ${Math.round(settings.get().units === 'metric' ? ((w.tempF - 32) * 5) / 9 : w.tempF)}°`;
  $('weather').title = w.label;
  $('weather').classList.remove('muted');
});
bus.on('glass', (g) => {
  $('smoothScore').textContent = g.score;
  $('smoothScore').style.color = g.score >= 90 ? 'var(--accent2)' : g.score >= 75 ? 'var(--warn)' : 'var(--danger)';
  $('spills').textContent = g.spills;
});
bus.on('spill', () => audio.sfx('spill'));

bus.on('collect', ({ place: p, distance: d, narrated, points }) => {
  if (place.info?.town) {
    p.town = place.info.town;
    stories.save();
  }
  audio.sfx(p.rarity === 'legendary' ? 'legendary' : p.rarity === 'rare' ? 'rare' : 'collect');
  if (narrated) showStory(p, d);
  const cls = p.rarity === 'common' ? '' : 'gold';
  const t = toast(`${CATS[p.cat].icon} <span><b>${escapeHtml(p.title)}</b><br><span class="muted">${p.rarity !== 'common' ? p.rarity.toUpperCase() + ' · ' : ''}+${points} XP · tap for story</span></span>`, cls);
  t.style.pointerEvents = 'auto';
  t.style.cursor = 'pointer';
  t.onclick = () => openDetail(p.id);
  refreshQuests();
});
bus.on('place-click', (id) => openDetail(id));
bus.on('sc-click', (s) => {
  const d = fix ? ` · ${fmtDist(Math.hypot((s.lat - fix.lat) * 111320, (s.lon - fix.lon) * 111320 * Math.cos((fix.lat * Math.PI) / 180)))}` : '';
  toast(`⚡ <span><b>${escapeHtml(s.name)} Supercharger</b><br><span class="muted">${s.stalls || '?'} stalls${s.kw ? ` · ${s.kw} kW` : ''}${d}</span></span>`, '', 6000);
});
bus.on('region-new', (r) => {
  audio.sfx('region');
  toast(`${r.icon} <span><b>${r.label}</b><br>${escapeHtml(r.name)}</span>`, 'gold', 7000);
  if (r.kind !== 'towns') speech.say(`${r.label} unlocked. Welcome to ${r.name.split(',')[0]}.`);
});
bus.on('quest-complete', (q) => {
  audio.sfx('quest');
  toast(`🏆 <span><b>Quest complete: ${escapeHtml(q.title)}</b><br><span class="muted">+${q.xp} XP</span></span>`, 'gold', 8000);
  speech.say(`Quest complete: ${q.title}.`);
});
bus.on('alert-ahead', () => audio.sfx('alert'));
bus.on('trip-start', () => {
  glass.reset();
  energy.reset();
  mapView.setTrail([]);
});
bus.on('trip-end', (t) => {
  if (!t) return;
  toast(`🏁 <span><b>Drive saved</b><br><span class="muted">${fmtDist(t.meters)} · smooth ${Math.round(t.score)} · ${t.places.length} places${t.kwh ? ` · ~${t.kwh.toFixed(1)} kWh` : ''}</span></span>`, 'gold', 9000);
  mapView.setHistory(trips.trips.slice(0, 40).map((x) => x.points));
  refreshQuests();
});
bus.on('motion', () => {
  if (!$('sheet').classList.contains('hidden')) renderSheetBody();
  if (skyTab.open && trips.moving && !passenger) skyTab.show();
});

// Car data
bus.on('elevation', ({ delta }) => energy.onElevation(delta));
bus.on('energy', (e) => {
  lastEnergy = e;
  if (trips.current) {
    trips.current.kwh = e.kwh;
    trips.current.whPerMile = e.whPerMile;
  }
});
bus.on('superchargers', () => mapView.setSuperchargers(superchargers.sites));
bus.on('nearest-sc', (list) => {
  const n = list[0];
  if (!n) return;
  $('scChip').classList.remove('hidden');
  $('scChipVal').textContent = fmtDist(n.meters);
  $('scChip').title = `Nearest Supercharger: ${n.name} (${n.stalls || '?'} stalls)`;
});

// Voice download feedback
let dlToast = false, readyToast = false;
bus.on('voice-status', () => {
  const st = speech.status();
  if (st.downloading && !dlToast) {
    dlToast = true;
    toast('🎙️ <span><b>Downloading the natural voice</b><br><span class="muted">One time, about 63 MB. Stories will be read aloud when it finishes.</span></span>', '', 8000);
  }
  if (st.neuralReady && dlToast && !readyToast) {
    readyToast = true;
    audio.sfx('collect', true);
    toast('🔊 <span><b>Natural voice ready</b><br><span class="muted">Tap Settings → Test sound to hear it.</span></span>', 'gold', 7000);
  }
  if (st.error && dlToast) toast(`⚠️ Voice download failed: ${escapeHtml(st.error)}`, '', 8000);
});
bus.on('net-error', (e) => console.warn(`[${e.source}]`, e.message));

// ---------- Start ----------
async function boot() {
  if (!window.maplibregl) {
    $('introStats').innerHTML = '<div class="is">Could not load the map engine. Check the internet connection and reload.</div>';
    return;
  }
  applySettings(settings.get());
  const center = ls.get('lastPos', [-71.0589, 42.3601]);
  mapView.init(center);
  await Promise.all([fog.load(), stories.load(), trips.load(), superchargers.load()]);
  $('exploredVal').textContent = fog.areaKm2.toFixed(2);
  mapView.setHistory(trips.trips.slice(0, 40).map((t) => t.points));
  mapView.setPlaces(visiblePlaces());
  if (superchargers.sites.length) mapView.setSuperchargers(superchargers.sites);
  if (trips.current) mapView.setTrail(trips.current.points);
  refreshQuests();
  renderIntro();
  addEventListener('visibilitychange', () => document.hidden && fog.save());
  addEventListener('pagehide', () => fog.save());
}

async function requestWakeLock() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}

function dismissStart() {
  audio.sfx('start', true);
  $('start').classList.add('gone');
  setTimeout(() => {
    intro.stop();
    $('start').remove();
  }, 700);
}

function startGps() {
  speech.unlock();
  requestWakeLock();
  source = new GpsSource();
  if (!source.start()) toast('⚠️ Location is not available here. Try the demo drive.', '', 8000);
  dismissStart();
}

async function startSim() {
  speech.unlock();
  requestWakeLock();
  dismissStart();
  toast('🎬 <span><b>Demo drive</b><br><span class="muted">Simulated route. Stories, fog, and the glass all work.</span></span>', '', 6000);
  const here = await new Promise((resolve) => {
    if (params.get('sim') === 'boston' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.latitude, p.coords.longitude]), () => resolve(null), { timeout: 4000 });
  });
  source = new SimSource();
  source.start(here);
}

$('startBtn').onclick = startGps;
$('simBtn').onclick = startSim;

boot().then(() => {
  if (params.has('sim') && params.has('autostart')) startSim();
});

// Cache the app shell so it still opens on weak LTE.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Expose for debugging from the console.
window.uncharted = { fog, mapView, glass, stories, place, trips, alerts, quests, settings, bus, RARITY, detail, carView, energy, elevation, superchargers, speech, audio, car, conn, skyTab };
