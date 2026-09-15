// Full-screen sections: Collection, Quests, Trips (+ animated recap and
// weekly wrap), Settings (+ diagnostics).
/* global maplibregl */
import { escapeHtml, fmtDist, fmtDuration, fmtSpeed, settings, idb, ls, sleep } from './util.js';
import { CATS, RARITY } from './stories.js';
import { CAT_COLORS } from './map.js';
import { speech } from './speech.js';
import { audio } from './audio.js';

const CELL_KM2 = (0.0004 * 111320) ** 2 / 1e6;

// Only one replay map at a time: WebGL contexts are scarce on car hardware.
let recapMap = null;
export function disposeRecap() {
  recapMap?.remove();
  recapMap = null;
}
const badge = (p) => `<span class="badge" style="background:${CAT_COLORS[p.cat]}">${CATS[p.cat].icon} ${CATS[p.cat].label}</span>`;
const scoreColor = (s) => (s >= 90 ? 'var(--accent2)' : s >= 75 ? 'var(--warn)' : 'var(--danger)');
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------------- Collection ----------------
export function renderCollection(root, { stories, place, mapView, closeSheet, openDetail }) {
  let filter = 'all';
  const draw = () => {
    const items = Object.values(stories.collection).sort((a, b) => b.gotAt - a.gotAt);
    const counts = Object.fromEntries(Object.keys(CATS).map((c) => [c, items.filter((p) => p.cat === c).length]));
    const shown = items.filter((p) => filter === 'all' || p.cat === filter || p.rarity === filter);
    const r = place.regions;
    root.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${items.length}</b><small>Places collected</small></div>
        <div class="stat"><b style="color:var(--gold)">${items.filter((p) => p.rarity === 'legendary').length}</b><small>Legendary</small></div>
        <div class="stat"><b style="color:var(--c-culture)">${items.filter((p) => p.rarity === 'rare').length}</b><small>Rare</small></div>
        <div class="stat"><b>${Object.keys(r.towns).length}</b><small>Towns</small></div>
        <div class="stat"><b>${Object.keys(r.counties).length}</b><small>Counties</small></div>
        <div class="stat"><b>${Object.keys(r.states).length}</b><small>States</small></div>
      </div>
      <div class="filters">
        <button data-f="all" class="${filter === 'all' ? 'on' : ''}">All ${items.length}</button>
        ${Object.entries(CATS).map(([k, c]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${c.icon} ${c.label} ${counts[k]}</button>`).join('')}
        <button data-f="legendary" class="${filter === 'legendary' ? 'on' : ''}">👑 Legendary</button>
        <button data-f="rare" class="${filter === 'rare' ? 'on' : ''}">✨ Rare</button>
      </div>
      ${shown.length ? `<div class="grid">${shown.map((p) => `
        <div class="item rar-${p.rarity}" data-id="${p.id}">
          <div class="img" style="${p.thumb ? `background-image:url('${escapeHtml(p.thumb)}')` : ''}">${badge(p)}</div>
          <div class="body">
            <h3>${p.rarity === 'legendary' ? '👑 ' : p.rarity === 'rare' ? '✨ ' : ''}${escapeHtml(p.title)}</h3>
            <p>${escapeHtml(p.desc || p.extract)}</p>
            <p style="margin-top:8px;font-size:13px">${when(p.gotAt)}${p.town ? ' · ' + escapeHtml(p.town) : ''} · +${RARITY[p.rarity]} XP</p>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn sm" data-act="tell">🔊 Listen</button>
              <button class="btn sm ghost" data-act="map">📍 Map</button>
            </div>
          </div>
        </div>`).join('')}</div>`
      : `<div class="empty-note">${items.length ? 'Nothing in this category yet.' : '💎 Drive past landmarks, parks, bridges and historic sites to start your collection.'}</div>`}`;
    root.querySelectorAll('.filters button').forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    root.querySelectorAll('.item').forEach((el) => {
      const id = el.dataset.id;
      el.onclick = (e) => !e.target.closest('button') && openDetail(id);
      el.querySelector('[data-act=tell]').onclick = () => stories.tell(id);
      el.querySelector('[data-act=map]').onclick = () => {
        const p = stories.collection[id];
        closeSheet();
        mapView.flyTo(p.lat, p.lon, 16.5);
      };
    });
  };
  draw();
}

// ---------------- Quests ----------------
export function renderQuests(root, { quests, deps }) {
  const q = quests.evaluate(deps);
  const row = (x) => `
    <div class="quest ${x.complete ? 'done' : ''}">
      <div class="qi">${x.complete ? '✅' : x.icon}</div>
      <div class="qb"><h3>${x.title} <span class="muted" style="font-size:14px">+${x.xp} XP</span></h3><p>${x.desc}</p>
        <div class="bar"><i style="width:${Math.round((x.complete ? 1 : x.pct) * 100)}%"></i></div></div>
      <div class="qp">${x.complete ? 'Done' : `${Math.floor(x.value * 10) / 10} / ${x.goal}`}</div>
    </div>`;
  root.innerHTML = `
    <div class="wrapped">
      <h2>Andrew &amp; Jenna · Level ${q.level} ${q.title}</h2>
      <div class="xp"><b>${q.xp.toLocaleString()}</b> XP · ${(q.nextXp - q.xp).toLocaleString()} to level ${q.level + 1}</div>
      <div class="bar" style="height:14px"><i style="width:${Math.round(q.levelPct * 100)}%"></i></div>
    </div>
    <h2 class="sec">Today's quests</h2>${q.daily.map(row).join('')}
    <h2 class="sec">Milestones · ${q.milestones.filter((m) => m.complete).length}/${q.milestones.length}</h2>${q.milestones.map(row).join('')}`;
}

// ---------------- Trips ----------------
export function renderTrips(root, deps) {
  disposeRecap();
  const { trips, stories } = deps;
  const week = trips.since(7 * 86400000);
  const miles = week.reduce((s, t) => s + t.meters, 0);
  const placesWeek = Object.values(stories.collection).filter((p) => Date.now() - p.gotAt < 7 * 86400000);
  const catCount = {};
  placesWeek.forEach((p) => (catCount[p.cat] = (catCount[p.cat] || 0) + 1));
  const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
  const L = trips.lifetime;

  root.innerHTML = `
    <div class="wrapped">
      <h2>🗓️ Andrew &amp; Jenna's week on the road</h2>
      <div class="stats" style="margin:0">
        <div class="stat"><b>${fmtDist(miles)}</b><small>Driven</small></div>
        <div class="stat"><b>${week.length}</b><small>Drives</small></div>
        <div class="stat"><b>${fmtDuration(week.reduce((s, t) => s + (t.end - t.start), 0))}</b><small>Behind the wheel</small></div>
        <div class="stat"><b>${(week.reduce((s, t) => s + t.newCells, 0) * CELL_KM2).toFixed(2)}</b><small>New km² revealed</small></div>
        <div class="stat"><b>${placesWeek.length}</b><small>Places collected</small></div>
        <div class="stat"><b style="color:var(--accent2)">${week.length ? Math.max(...week.map((t) => t.score)) : '—'}</b><small>Best smooth score</small></div>
        <div class="stat"><b>${topCat ? CATS[topCat[0]].icon + ' ' + CATS[topCat[0]].label : '—'}</b><small>Top collection</small></div>
        <div class="stat"><b>🔥 ${trips.streak()}</b><small>Day streak</small></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>${fmtDist(L.meters)}</b><small>Lifetime distance</small></div>
      <div class="stat"><b>${L.trips}</b><small>Lifetime drives</small></div>
      <div class="stat"><b>${fmtDuration(L.ms)}</b><small>Lifetime time</small></div>
      <div class="stat"><b>${L.bestScore || '—'}</b><small>Best score (3 km+)</small></div>
    </div>
    <h2 class="sec">Recent drives</h2>
    ${trips.trips.length ? trips.trips.slice(0, 40).map((t, i) => `
      <div class="trip">
        <div class="score" style="color:${scoreColor(t.score)}">${Math.round(t.score)}</div>
        <div class="tb"><h3>${when(t.start)}${t.sim ? ' <span class="muted">(demo)</span>' : ''}</h3>
          <p>${fmtDist(t.meters)} · ${fmtDuration(t.end - t.start)} · top ${fmtSpeed(t.maxSpeed)} ${settings.get().units === 'metric' ? 'km/h' : 'mph'} · ${t.places.length} places · ${t.spills} spills${t.regions.length ? ' · new: ' + escapeHtml(t.regions.join(', ')) : ''}</p></div>
        <button class="btn" data-i="${i}">▶ Replay</button>
      </div>`).join('') : `<div class="empty-note">🛣️ Drives are recorded automatically once you start moving.</div>`}`;
  root.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => renderRecap(root, deps, trips.trips[+b.dataset.i])));
}

// Animated replay: the route draws itself and places pop in as they're reached.
export async function renderRecap(root, deps, trip) {
  const { stories } = deps;
  const places = trip.places.map((id) => stories.collection[id]).filter(Boolean);
  root.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
      <button class="btn ghost" id="rBack">← All drives</button>
      <h2 style="margin:0;flex:1">${when(trip.start)} · ${fmtDist(trip.meters)} · smooth ${Math.round(trip.score)}</h2>
      <button class="btn" id="rAgain">↻ Replay</button>
    </div>
    <div class="two-col"><div class="recap-map" id="rMap"></div><div class="recap-side" id="rSide"></div></div>`;
  root.querySelector('#rBack').onclick = () => renderTrips(root, deps);

  const pts = trip.points.map((p) => [p[1], p[0]]);
  if (pts.length < 2) return;
  const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  disposeRecap();
  const map = (recapMap = new maplibregl.Map({ container: 'rMap', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', bounds, fitBoundsOptions: { padding: 60 }, attributionControl: { compact: true } }));
  let run = 0;
  const play = async () => {
    const my = ++run;
    const side = root.querySelector('#rSide');
    side.innerHTML = '';
    map.getSource('r').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    document.querySelectorAll('.recap-mk').forEach((m) => m.remove());
    const steps = 160;
    const shown = new Set();
    for (let s = 1; s <= steps; s++) {
      if (my !== run || !document.getElementById('rMap')) return;
      const n = Math.max(2, Math.round((pts.length * s) / steps));
      const slice = pts.slice(0, n);
      map.getSource('r').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: slice } });
      const head = slice.at(-1);
      map.getSource('head').setData({ type: 'Point', coordinates: head });
      const elapsed = trip.points[n - 1][2] * 1000 + trip.start;
      for (const p of places) {
        if (shown.has(p.id) || p.gotAt > elapsed) continue;
        shown.add(p.id);
        const el = document.createElement('div');
        el.className = 'poi recap-mk';
        el.style.color = CAT_COLORS[p.cat];
        new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
        side.insertAdjacentHTML('afterbegin', `<div class="trip recap-pop" data-id="${p.id}" style="cursor:pointer"><div style="font-size:30px">${CATS[p.cat].icon}</div><div class="tb"><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.desc || '')}</p></div></div>`);
        side.firstElementChild.onclick = () => deps.openDetail?.(p.id);
      }
      await sleep(Math.max(12, 7000 / steps));
    }
    side.insertAdjacentHTML('afterbegin', `<div class="trip recap-pop" style="border-color:rgba(124,247,212,.5)"><div style="font-size:30px">🏁</div><div class="tb"><h3>Drive complete</h3>
      <p>${fmtDist(trip.meters)} · ${fmtDuration(trip.end - trip.start)} · ${places.length} places · ${(trip.newCells * CELL_KM2).toFixed(2)} km² new · ${trip.spills} spills · peak ${trip.peakG.toFixed(2)} g</p></div></div>`);
  };
  map.on('load', () => {
    map.addSource('r', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addSource('head', { type: 'geojson', data: { type: 'Point', coordinates: pts[0] } });
    map.addLayer({ id: 'rg', type: 'line', source: 'r', paint: { 'line-color': '#3fb6ff', 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'rc', type: 'line', source: 'r', paint: { 'line-color': '#b8f0ff', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'hd', type: 'circle', source: 'head', paint: { 'circle-radius': 9, 'circle-color': '#fff', 'circle-stroke-color': '#3fb6ff', 'circle-stroke-width': 4 } });
    play();
  });
  root.querySelector('#rAgain').onclick = () => map.loaded() && play();
}

// ---------------- Settings ----------------
export function renderSettings(root, deps) {
  const s = settings.get();
  const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tog = (key) => seg(key, [[true, 'On'], [false, 'Off']]);
  root.innerHTML = `
    <h2 class="sec">Display</h2>
    <div class="set-row"><div class="sl"><b>Units</b><span>Speed and distance</span></div>${seg('units', [['imperial', 'mi · mph'], ['metric', 'km · km/h']])}</div>
    <div class="set-row"><div class="sl"><b>Map tilt</b><span>3D perspective of the follow camera</span></div>${seg('pitch', [[0, 'Flat'], [45, 'Tilted'], [60, 'Deep']])}</div>
    <div class="set-row"><div class="sl"><b>Glass of water</b><span>Smooth-driving coach on the map</span></div>${tog('showGlass')}</div>
    <h2 class="sec">Narration</h2>
    <div class="set-row"><div class="sl"><b>Place stories</b><span>Read nearby places aloud</span></div>${tog('voice')}</div>
    <div class="set-row"><div class="sl"><b>How often</b><span>Minimum gap between stories</span></div>${seg('storyFreq', [['chill', 'Chill'], ['normal', 'Normal'], ['chatty', 'Chatty']])}</div>
    <div class="set-row"><div class="sl"><b>Story length</b><span></span></div>${seg('storyLength', [['short', 'Short'], ['long', 'Long']])}</div>
    <div class="set-row"><div class="sl"><b>Categories</b><span>What gets collected and narrated</span></div>
      <div class="filters" style="margin:0">${Object.entries(CATS).map(([k, c]) => `<button data-cat="${k}" class="${s.categories[k] ? 'on' : ''}">${c.icon} ${c.label}</button>`).join('')}</div></div>
    <h2 class="sec">Sound</h2>
    <div class="set-row"><div class="sl"><b>Voice engine</b><span>Auto uses the car's built-in voices if it has any, otherwise the natural voice</span></div>${seg('voiceEngine', [['auto', 'Auto'], ['browser', 'Car voices'], ['natural', 'Natural']])}</div>
    <div class="set-row"><div class="sl"><b>Voice status</b><div class="voice-status" id="sVoice">…</div><div class="voice-bar hidden" id="sVoiceBar"><i></i></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn ghost" id="sVoiceDl">⬇ Natural voice</button><button class="btn" id="sTest">🔊 Test sound</button></div></div>
    <div class="set-row"><div class="sl"><b>Sound effects</b><span>Chimes for collections, quests and alerts</span></div>${tog('sfx')}</div>
    <div class="set-row"><div class="sl"><b>No sound in the car?</b>
      <ul class="tips">
        <li>Many Tesla software versions only play browser audio while the car is in Park.</li>
        <li>Tap <b>Test sound</b>. If you hear the chime but no voice, set Voice engine to <b>Natural</b>.</li>
        <li>Still silent? Start and pause any media (radio, Spotify) or disconnect phone Bluetooth audio, then test again.</li>
        <li>Check the media volume, not the navigation volume.</li>
      </ul></div></div>
    <h2 class="sec">Your car</h2>
    <div class="set-row"><div class="sl"><b>Model 3 trim</b><span>Used for the energy estimate (2022–2023 models)</span></div>${seg('trim', [['rwd', 'RWD'], ['lr', 'Long Range'], ['perf', 'Performance']])}</div>
    <h2 class="sec">Alerts</h2>
    <div class="set-row"><div class="sl"><b>Spoken alerts</b><span>Speed and red-light cameras (OpenStreetMap), plus feed alerts</span></div>${tog('alertVoice')}</div>
    <div class="set-row"><div class="sl"><b>Alert feed URL (advanced, optional)</b><span>A proxy that returns Waze live-map JSON for spoken police/crash alerts. See README.</span></div>
      <input type="text" id="sFeed" placeholder="https://your-proxy.example/georss" value="${escapeHtml(s.wazeFeedUrl)}"></div>
    <h2 class="sec">Diagnostics</h2>
    <div class="diag" id="sDiag">…</div>
    <h2 class="sec">Data</h2>
    <div class="set-row"><div class="sl"><b>Reset everything</b><span>Fog map, collection, trips, quests. Can't be undone.</span></div><button class="btn danger" id="sReset">Reset</button></div>
    <div class="made-for">for Andrew &amp; Jenna <i>✦</i> by Andrew &amp; Jenna</div>
    <p class="muted small" style="margin-top:8px;text-align:center">Map © OpenStreetMap contributors © CARTO · Places © Wikipedia (CC BY-SA) · Weather &amp; elevation Open-Meteo · Superchargers supercharge.info · Voice Piper (MIT) · Live traffic embed © Waze</p>`;

  root.querySelectorAll('.seg').forEach((el) => el.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const raw = b.dataset.v;
    const v = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? +raw : raw;
    settings.set({ [el.dataset.key]: v });
    if (el.dataset.key === 'voiceEngine') speech.init();
    renderSettings(root, deps);
  })));
  root.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => {
    settings.set({ categories: { ...settings.get().categories, [b.dataset.cat]: !settings.get().categories[b.dataset.cat] } });
    renderSettings(root, deps);
  }));
  root.querySelector('#sFeed').onchange = (e) => settings.set({ wazeFeedUrl: e.target.value.trim() });
  root.querySelector('#sTest').onclick = () => {
    audio.unlock();
    if (!speech.engine) speech.init();
    speech.test();
  };
  root.querySelector('#sVoiceDl').onclick = () => speech.neural.prepare();
  let armed = false;
  root.querySelector('#sReset').onclick = async (e) => {
    if (!armed) {
      armed = true;
      e.target.textContent = 'Tap again to confirm';
      return;
    }
    await idb.clear();
    Object.keys(localStorage).filter((k) => k.startsWith('uc:')).forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  const diag = root.querySelector('#sDiag');
  const tick = async () => {
    if (!document.body.contains(diag)) return;
    const vs = speech.status();
    const label = { native: 'Car voices', neural: 'Natural voice', none: 'None' }[vs.engine] || 'Starts when you tap Start';
    root.querySelector('#sVoice').textContent = `${label} · car voices found: ${vs.nativeVoices} · natural voice: ${
      vs.neuralReady ? 'ready' : vs.downloading ? `downloading ${Math.round(vs.progress * 100)}%` : vs.error ? 'error — ' + vs.error : 'not downloaded'} · audio ${vs.audio}`;
    root.querySelector('#sVoiceBar').classList.toggle('hidden', !vs.downloading);
    root.querySelector('#sVoiceBar i').style.width = `${Math.round(vs.progress * 100)}%`;
    root.querySelector('#sVoiceDl').classList.toggle('hidden', vs.neuralReady);
    const f = deps.getFix();
    let storage = '';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) storage = `${(est.usage / 1e6).toFixed(1)} MB used of ${(est.quota / 1e6).toFixed(0)} MB`;
    } catch {}
    const gl = !!document.createElement('canvas').getContext('webgl');
    diag.textContent = [
      `Location source : ${f ? f.source : 'none yet'}   (${deps.getGps().message || ''})`,
      `Position        : ${f ? `${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}  ±${Math.round(f.acc)} m` : '—'}`,
      `Speed / heading : ${f ? `${f.speed.toFixed(1)} m/s  /  ${f.heading == null ? '—' : Math.round(f.heading) + '°'}` : '—'}`,
      `Update rate     : ${f ? f.rate.toFixed(2) + ' Hz' : '—'}`,
      `Voice engine    : ${speech.engine || 'not started'} · car voices ${window.speechSynthesis ? speechSynthesis.getVoices().length : 0} · natural ${speech.neural.ready ? 'ready' : 'not loaded'} (${speech.neural.mode || '—'})`,
      `Audio output    : ${audio.state}`,
      `Tesla browser   : ${deps.car.isTesla ? `yes · ${deps.car.version}` : 'no'} · ${deps.car.computer}`,
      `WebGL           : ${gl ? 'yes' : 'NO'}`,
      `Screen          : ${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
      `Storage         : ${storage || '—'}`,
      `Fog cells       : ${deps.fog.cells.size.toLocaleString()} (${deps.fog.areaKm2.toFixed(2)} km²)`,
      `Places known    : ${deps.stories.places.size} · collected ${Object.keys(deps.stories.collection).length}`,
      `Cameras nearby  : ${deps.alerts.cameras.length} · feed alerts ${deps.alerts.feed.length}`,
      `Browser         : ${navigator.userAgent}`,
    ].join('\n');
    setTimeout(tick, 1000);
  };
  tick();
  void ls;
}
