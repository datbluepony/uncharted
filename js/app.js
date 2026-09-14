// Uncharted: wires location → fog, map, storyteller, glass, trips, alerts, UI.
import { bus, ls, settings, fmtSpeed, fmtDist, escapeHtml } from './util.js';
import { GpsSource } from './geo.js';
import { SimSource } from './sim.js';
import { Fog } from './fog.js';
import { MapView } from './map.js';
import { Glass } from './glass.js';
import { speech } from './speech.js';
import { Stories, CATS, RARITY } from './stories.js';
import { Place } from './place.js';
import { Trips } from './trips.js';
import { Alerts } from './waze.js';
import { Quests } from './quests.js';
import { renderQuiz } from './quiz.js';
import { renderCollection, renderQuests, renderTrips, renderSettings, disposeRecap } from './sheets.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const fog = new Fog();
const mapView = new MapView(fog);
const glass = new Glass($('glass'));
const stories = new Stories();
const place = new Place();
const trips = new Trips();
const alerts = new Alerts();
const quests = new Quests();

let fix = null;
let gpsState = { state: 'none', message: 'Waiting' };
let source = null;
let passenger = false;
let activeTab = 'drive';
const deps = { trips, stories, fog, place, alerts, mapView, getFix: () => fix, getGps: () => gpsState };

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
}

let storyTimer = null;
function showStory(p, d) {
  const card = $('story');
  card.classList.remove('hidden', 'out');
  void card.offsetWidth; // restart animation
  $('storyImg').style.backgroundImage = p.thumb ? `url("${p.thumb}")` : '';
  $('storyImg').classList.toggle('empty', !p.thumb);
  $('storyCat').textContent = `${CATS[p.cat].icon} ${CATS[p.cat].label}${p.rarity !== 'common' ? ' · ' + p.rarity : ''}`;
  $('storyDist').textContent = d != null ? (d < 120 ? 'here' : fmtDist(d)) : 'collected';
  $('storyTitle').textContent = p.title;
  $('storyText').textContent = (p.extract.match(/[^.!?]+[.!?]+(\s|$)/g) || [p.extract]).slice(0, 3).join(' ');
  clearTimeout(storyTimer);
  storyTimer = setTimeout(hideStory, 16000);
}
function hideStory() {
  const card = $('story');
  if (card.classList.contains('hidden')) return;
  card.classList.add('out');
  setTimeout(() => card.classList.add('hidden'), 450);
}
$('storyClose').onclick = hideStory;

function setDock(tab) {
  activeTab = tab;
  document.querySelectorAll('#dock [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

const SHEETS = {
  collection: ['Collection', (root) => renderCollection(root, { stories, place, mapView, closeSheet })],
  quests: ['Quests', (root) => renderQuests(root, { quests, deps })],
  trips: ['Trips', (root) => renderTrips(root, deps)],
  quiz: ['Road Quiz', (root) => renderQuiz(root, stories.collection, stories.list(), refreshQuests)],
  settings: ['Settings', (root) => renderSettings(root, deps)],
};
const LOCKED = new Set(['collection', 'quests', 'trips', 'quiz']);

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
  const locked = LOCKED.has(activeTab) && trips.moving && !passenger;
  $('sheetLock').classList.toggle('hidden', !locked);
  $('sheetBody').classList.toggle('hidden', locked);
  if (!locked) SHEETS[activeTab][1]($('sheetBody'));
  else $('sheetBody').innerHTML = '';
}
function closeSheet() {
  disposeRecap();
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
  mapView.setPlaces(visiblePlaces());
  if (fix) mapView.update(fix, true);
}
const visiblePlaces = () => stories.list().filter((p) => settings.get().categories[p.cat]);

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
bus.on('fix', (f) => {
  fix = f;
  if (f.t - lastPosSave > 30000) {
    lastPosSave = f.t;
    ls.set('lastPos', [f.lon, f.lat]);
  }
  $('speedVal').textContent = fmtSpeed(f.speed);
  fog.reveal(f);
  mapView.update(f);
  glass.onFix(f);
  trips.onFix(f);
  stories.onFix(f);
  place.onFix(f);
  alerts.onFix(f);
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

bus.on('collect', ({ place: p, distance: d, narrated, points }) => {
  if (place.info?.town) {
    p.town = place.info.town;
    stories.save();
  }
  if (narrated) showStory(p, d);
  const cls = p.rarity === 'common' ? '' : 'gold';
  toast(`${CATS[p.cat].icon} <span><b>${escapeHtml(p.title)}</b><br><span class="muted">${p.rarity !== 'common' ? p.rarity.toUpperCase() + ' · ' : ''}+${points} XP</span></span>`, cls);
  refreshQuests();
});
bus.on('place-click', (id) => {
  const p = stories.tell(id);
  if (p && fix) showStory(p, null);
});
bus.on('region-new', (r) => {
  toast(`${r.icon} <span><b>${r.label}</b><br>${escapeHtml(r.name)}</span>`, 'gold', 7000);
  if (r.kind !== 'towns') speech.say(`${r.label} unlocked. Welcome to ${r.name.split(',')[0]}.`);
});
bus.on('quest-complete', (q) => {
  toast(`🏆 <span><b>Quest complete: ${escapeHtml(q.title)}</b><br><span class="muted">+${q.xp} XP</span></span>`, 'gold', 8000);
  speech.say(`Quest complete: ${q.title}.`);
});
bus.on('trip-start', () => {
  glass.reset();
  mapView.setTrail([]);
});
bus.on('trip-end', (t) => {
  if (!t) return;
  toast(`🏁 <span><b>Drive saved</b><br><span class="muted">${fmtDist(t.meters)} · smooth ${Math.round(t.score)} · ${t.places.length} places</span></span>`, 'gold', 9000);
  mapView.setHistory(trips.trips.slice(0, 40).map((x) => x.points));
  refreshQuests();
});
bus.on('motion', () => {
  if (!$('sheet').classList.contains('hidden')) renderSheetBody();
});
bus.on('net-error', (e) => console.warn(`[${e.source}]`, e.message));

// ---------- Start ----------
async function boot() {
  if (!window.maplibregl) {
    $('start').querySelector('.tag').textContent = 'Could not load the map engine. Check the internet connection and reload.';
    return;
  }
  applySettings(settings.get());
  const center = ls.get('lastPos', [-71.0589, 42.3601]);
  mapView.init(center);
  await Promise.all([fog.load(), stories.load(), trips.load()]);
  $('exploredVal').textContent = fog.areaKm2.toFixed(2);
  mapView.setHistory(trips.trips.slice(0, 40).map((t) => t.points));
  mapView.setPlaces(visiblePlaces());
  if (trips.current) mapView.setTrail(trips.current.points);
  refreshQuests();
  addEventListener('visibilitychange', () => document.hidden && fog.save());
  addEventListener('pagehide', () => fog.save());
}

async function requestWakeLock() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}

function dismissStart() {
  $('start').classList.add('gone');
  setTimeout(() => $('start').remove(), 700);
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
window.uncharted = { fog, mapView, glass, stories, place, trips, alerts, quests, settings, bus, RARITY };
