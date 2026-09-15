// The Sky tab: full-screen star map oriented to where the car is pointing,
// plus Solar System and Galaxy views. Handles data loading (cached for
// offline), the info card, search shortcuts, layers, time travel and the
// cosmic speedometer.
/* global Astronomy */
import { idb, escapeHtml, clamp } from '../util.js';
import { SkyView } from './skyview.js';
import { Cosmos } from './cosmos.js';
import { CONST_INFO, PLANET_INFO, PLANETS, DSOS, ASTERISMS, fmtLy, constellationWiki } from './skydata.js';

const ASTRO_URL = 'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js';
const DATA_URL = 'https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/';
const DATA_KEY = 'skydata-v1';
const $ = (root, sel) => root.querySelector(sel);
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (az) => CARD[Math.round(az / 45) % 8];
const tfmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Astronomy) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the astronomy engine'));
    document.head.appendChild(s);
  });
}

export class SkyTab {
  constructor(root, deps) {
    this.root = root;
    this.d = deps;
    this.mode = 'sky';
    this.built = false;
    this.playing = false;
  }

  get open() {
    return !this.root.classList.contains('hidden');
  }

  async show() {
    this.root.classList.remove('hidden');
    this.root.classList.add('sky-enter');
    setTimeout(() => this.root.classList.remove('sky-enter'), 700);
    if (!this.built) this.build();
    if (this.d.isLocked()) {
      $(this.root, '#skyLock').classList.remove('hidden');
      return;
    }
    $(this.root, '#skyLock').classList.add('hidden');
    try {
      await this.ensureLoaded();
    } catch (e) {
      $(this.root, '#skyLoading').innerHTML = `<div class="sky-load-card"><b>The sky couldn't load</b><p>${escapeHtml(e.message)}. Check the connection and try again.</p></div>`;
      return;
    }
    this.syncFix(this.d.getFix(), true);
    this.setMode(this.mode);
  }

  hide() {
    this.root.classList.add('hidden');
    this.sky?.stop();
    this.cosmos?.stop();
    clearInterval(this.hudTimer);
    this.playing = false;
  }

  // ---------- DOM ----------
  build() {
    this.built = true;
    this.root.innerHTML = `
      <div class="sky-stage" id="skyStage"></div>
      <div class="sky-stage hidden" id="cosmosStage"></div>
      <header class="sky-top">
        <div class="seg sky-modes" id="skyModes">
          <button data-mode="sky" class="on">✨ Sky</button>
          <button data-mode="solar">🪐 Solar System</button>
          <button data-mode="galaxy">🌌 Galaxy</button>
        </div>
        <div class="sky-read" id="skyRead"></div>
        <button class="btn ghost sky-close" id="skyClose">✕</button>
      </header>
      <div class="sky-find" id="skyFind"></div>
      <aside class="sky-info hidden" id="skyInfo"></aside>
      <div class="sky-speedo" id="skySpeedo"></div>
      <footer class="sky-bottom" id="skyBottom"></footer>
      <div class="sky-loading" id="skyLoading">
        <div class="orbit-loader"><i></i><i></i><i></i></div>
        <b>Mapping the heavens</b><span id="skyLoadMsg">Loading 5,044 stars…</span>
      </div>
      <div class="sky-lock hidden" id="skyLock">
        <div class="lock-icon">🔭</div><h2>The sky opens for passengers</h2>
        <p>Stargazing is best when someone else is watching the road.</p>
        <button class="btn" id="skyPassenger">I'm a passenger</button>
      </div>`;
    $(this.root, '#skyClose').onclick = () => this.d.onClose();
    $(this.root, '#skyPassenger').onclick = () => {
      this.d.unlockPassenger();
      this.show();
    };
    this.root.querySelectorAll('#skyModes [data-mode]').forEach((b) => (b.onclick = () => this.setMode(b.dataset.mode)));
  }

  async ensureLoaded() {
    if (this.sky) return;
    const msg = $(this.root, '#skyLoadMsg');
    msg.textContent = 'Loading the astronomy engine…';
    const astro = loadScript(ASTRO_URL);
    let data = await idb.get(DATA_KEY, null);
    if (!data) {
      msg.textContent = 'Downloading the star catalog (one time)…';
      const get = (f) => fetch(DATA_URL + f).then((r) => {
        if (!r.ok) throw new Error(`Star data unavailable (${r.status})`);
        return r.json();
      });
      const [stars, names, lines, consts] = await Promise.all([get('stars.6.json'), get('starnames.json'), get('constellations.lines.json'), get('constellations.json')]);
      // Keep only the name fields we use to save space
      const slimNames = {};
      for (const [k, v] of Object.entries(names)) if (v.name || v.desig) slimNames[k] = { name: v.name, desig: v.desig, c: v.c };
      data = { stars, names: slimNames, lines, consts };
      idb.set(DATA_KEY, data);
    }
    await astro;
    msg.textContent = 'Placing the planets…';
    this.sky = new SkyView($(this.root, '#skyStage'), {
      onSelect: (obj) => this.showInfo(obj),
      onCamera: () => this.updateReadout(),
    });
    this.sky.setData(data);
    this.data = data;
    const loading = $(this.root, '#skyLoading');
    loading.classList.add('done');
    setTimeout(() => loading.classList.add('hidden'), 700);
  }

  setMode(mode) {
    this.mode = mode;
    this.root.querySelectorAll('#skyModes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    this.root.dataset.mode = mode;
    $(this.root, '#skyInfo').classList.add('hidden');
    const isSky = mode === 'sky';
    $(this.root, '#skyStage').classList.toggle('hidden', !isSky);
    $(this.root, '#cosmosStage').classList.toggle('hidden', isSky);
    if (isSky) {
      this.cosmos?.stop();
      this.sky.start();
    } else {
      this.sky?.stop();
      if (!this.cosmos) this.cosmos = new Cosmos($(this.root, '#cosmosStage'), { onSelect: (hit) => this.showCosmosInfo(hit) });
      this.cosmos.setMode(mode);
      this.cosmos.resize();
      this.cosmos.start();
    }
    this.renderBottom();
    this.renderFind();
    this.renderSpeedo();
    clearInterval(this.hudTimer);
    this.hudTimer = setInterval(() => {
      this.renderSpeedo();
      if (this.mode === 'sky') this.renderFind(true);
    }, 1000);
  }

  // ---------- live position ----------
  syncFix(fix, force = false) {
    if (!this.sky || !fix) return;
    const moved = !this.obs || Math.abs(this.obs.lat - fix.lat) + Math.abs(this.obs.lon - fix.lon) > 0.05;
    if (moved || force) {
      this.obs = { lat: fix.lat, lon: fix.lon };
      this.sky.setObserver(fix.lat, fix.lon);
    }
    this.sky.setHeading(fix.speed > 1.5 || fix.heading != null ? fix.heading : null);
  }

  onFix(fix) {
    this.fix = fix;
    if (this.open) this.syncFix(fix);
  }

  // ---------- HUD ----------
  updateReadout() {
    const now = performance.now();
    if (now - (this.lastRead || 0) < 150) return;
    this.lastRead = now;
    const c = this.sky.cam;
    const ahead = this.sky.heading;
    const rel = ahead != null ? angDiff(ahead, c.az) : null;
    const relTxt = rel == null ? '' : Math.abs(rel) < 12 ? ' · out the windshield' : Math.abs(rel) > 150 ? ' · behind the car' : rel > 0 ? ` · ${Math.round(rel)}° right of the car` : ` · ${Math.round(-rel)}° left of the car`;
    $(this.root, '#skyRead').innerHTML = `Facing <b>${cardinal(c.az)} ${Math.round(c.az)}°</b> · <b>${Math.round(c.alt)}°</b> up${relTxt}${this.sky.timeOffset ? ` · <span class="sky-timewarp">${this.sky.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>` : ''}`;
  }

  renderBottom() {
    const el = $(this.root, '#skyBottom');
    if (this.mode === 'sky') {
      const L = this.sky.layers;
      const tog = (k, label) => `<button class="sky-chip ${L[k] ? 'on' : ''}" data-layer="${k}">${label}</button>`;
      el.innerHTML = `
        <div class="sky-tools">
          <button class="sky-chip accent" id="skyCar">🚘 Car view</button>
          <button class="sky-chip" id="skyUp">⬆ Look up</button>
          <span class="sky-sep"></span>
          ${tog('lines', 'Lines')}${tog('labels', 'Names')}${tog('asterisms', 'Shapes')}${tog('planets', 'Planets')}${tog('milkyway', 'Milky Way')}${tog('grid', 'Grid')}${tog('night', '🔴 Night vision')}
        </div>
        <div class="sky-time">
          <button class="sky-chip" id="skyPlay">${this.playing ? '⏸' : '⏩'}</button>
          <input type="range" id="skySlider" min="-720" max="720" step="1" value="${Math.round(this.sky.timeOffset / 60000)}">
          <button class="sky-chip" id="skyNow">Now</button>
          <span id="skyTimeLbl" class="sky-time-lbl"></span>
        </div>`;
      $(el, '#skyCar').onclick = () => this.sky.recenter();
      $(el, '#skyUp').onclick = () => this.sky.lookUp();
      el.querySelectorAll('[data-layer]').forEach((b) => (b.onclick = () => {
        L[b.dataset.layer] = !L[b.dataset.layer];
        b.classList.toggle('on', L[b.dataset.layer]);
        this.root.classList.toggle('night', L.night);
      }));
      const slider = $(el, '#skySlider');
      const lbl = $(el, '#skyTimeLbl');
      const setOffset = (min) => {
        this.sky.timeOffset = min * 60000;
        this.sky.timeDirty = true;
        slider.value = clamp(Math.round(min), -720, 720);
        lbl.textContent = min === 0 ? 'Live' : `${min > 0 ? '+' : '−'}${Math.floor(Math.abs(min) / 60)}h ${Math.abs(Math.round(min)) % 60}m · ${tfmt(this.sky.date)}`;
      };
      setOffset(Math.round(this.sky.timeOffset / 60000));
      slider.oninput = () => setOffset(+slider.value);
      $(el, '#skyNow').onclick = () => { this.playing = false; $(el, '#skyPlay').textContent = '⏩'; setOffset(0); };
      $(el, '#skyPlay').onclick = () => {
        this.playing = !this.playing;
        $(el, '#skyPlay').textContent = this.playing ? '⏸' : '⏩';
        const step = () => {
          if (!this.playing || this.mode !== 'sky' || !this.open) return;
          let min = this.sky.timeOffset / 60000 + 4; // 4 minutes of sky per frame ≈ 4 h per second
          if (min > 720) min = -720;
          setOffset(min);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
    } else if (this.mode === 'solar') {
      const speeds = [[0, 'Live'], [1, '1 day/s'], [7, '1 week/s'], [30, '1 month/s'], [365, '1 year/s']];
      el.innerHTML = `<div class="sky-tools">${speeds.map(([v, l]) => `<button class="sky-chip ${this.cosmos.daysPerSec === v ? 'on' : ''}" data-speed="${v}">${l}</button>`).join('')}
        <span class="sky-sep"></span><button class="sky-chip" id="cosToday">Today</button><span class="sky-time-lbl" id="cosDate"></span>
        <span class="sky-sep"></span><span class="muted small">Drag to rotate or tilt · pinch to zoom · tap a planet</span></div>`;
      el.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => {
        this.cosmos.daysPerSec = +b.dataset.speed;
        el.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      $(el, '#cosToday').onclick = () => { this.cosmos.simOffset = 0; };
    } else {
      el.innerHTML = `<div class="sky-tools"><span class="muted small">Drag to spin or tilt the galaxy · pinch to zoom · tap “You are here”</span></div>`;
    }
  }

  renderFind(refreshOnly = false) {
    const el = $(this.root, '#skyFind');
    if (this.mode !== 'sky') {
      el.innerHTML = '';
      return;
    }
    const sky = this.sky;
    sky.computeMatrices();
    sky.updateBodies();
    const up = (v) => sky.horizontal(v).alt > 0;
    const chips = [];
    const moon = sky.bodies.find((b) => b.name === 'Moon');
    if (moon && up(moon.v)) chips.push(['body:Moon', '🌙 Moon']);
    chips.push(['star:11767', '⭐ North Star']);
    chips.push(['asterism:big-dipper', '🥄 Big Dipper']);
    for (const p of PLANETS) {
      const b = sky.bodies.find((x) => x.name === p);
      if (b && up(b.v) && (b.mag ?? 9) < 3) chips.push([`body:${p}`, `🪐 ${p}`]);
    }
    for (const a of ASTERISMS) if (a.id !== 'big-dipper' && sky.asterisms && up(sky.asterisms.find((x) => x.id === a.id).center)) chips.push([`asterism:${a.id}`, `✦ ${a.name}`]);
    for (const d of DSOS) if (up(sky.dsos.find((x) => x.id === d.id).v)) chips.push([`dso:${d.id}`, `◌ ${d.name}`]);
    chips.push(['const:Ori', '🏹 Orion']);
    const key = chips.map((c) => c[0]).join('|');
    if (refreshOnly && key === this.findKey) return;
    this.findKey = key;
    el.innerHTML = `<span class="sky-find-lbl">Find</span>${chips.map(([k, l]) => `<button class="sky-chip" data-find="${k}">${escapeHtml(l)}</button>`).join('')}`;
    el.querySelectorAll('[data-find]').forEach((b) => (b.onclick = () => this.find(b.dataset.find)));
  }

  find(key) {
    const [kind, id] = key.split(':');
    const sky = this.sky;
    let obj = null;
    if (kind === 'body') obj = sky.bodies.find((b) => b.name === id);
    else if (kind === 'star') obj = sky.starById.get(+id);
    else if (kind === 'asterism') obj = sky.asterisms.find((a) => a.id === id);
    else if (kind === 'dso') obj = sky.dsos.find((d) => d.id === id);
    else if (kind === 'const') obj = sky.constellations.find((c) => c.id === id);
    if (!obj) return;
    sky.flyTo(obj);
    sky.select(obj);
  }

  // ---------- info card ----------
  where(v) {
    const sky = this.sky;
    const h = sky.horizontal(v);
    const heading = sky.heading;
    let dir;
    if (heading != null) {
      const rel = angDiff(heading, h.az);
      const a = Math.abs(rel), side = rel > 0 ? 'right' : 'left';
      dir = a < 25 ? 'ahead of the car' : a < 70 ? `ahead to the ${side}` : a < 110 ? `to your ${side}` : a < 155 ? `behind you to the ${side}` : 'behind the car';
    } else {
      dir = `in the ${cardinal(h.az)}`;
    }
    const height = h.alt < 0 ? null : h.alt < 12 ? 'low on the horizon' : h.alt < 35 ? 'low in the sky' : h.alt < 60 ? 'halfway up' : h.alt < 80 ? 'high up' : 'almost straight overhead';
    return { alt: h.alt, az: h.az, text: height ? `${Math.round(h.alt)}° up, ${height}, ${dir}` : `Below the horizon right now (${dir})` };
  }

  riseSet(name) {
    try {
      const obs = new Astronomy.Observer(this.sky.lat, this.sky.lon, 0);
      const date = this.sky.date;
      const rise = Astronomy.SearchRiseSet(name, obs, +1, date, 2);
      const set = Astronomy.SearchRiseSet(name, obs, -1, date, 2);
      return { rise: rise?.date, set: set?.date };
    } catch {
      return {};
    }
  }

  showInfo(obj) {
    const el = $(this.root, '#skyInfo');
    if (!obj) {
      el.classList.add('hidden');
      return;
    }
    this.d.audio.sfx('select');
    const sky = this.sky;
    const chip = (label, value) => `<div class="si-stat"><small>${label}</small><b>${value}</b></div>`;
    let title = '', sub = '', stats = '', fact = '', wiki = null, extra = '';
    const v = obj.v || obj.center || obj.label;
    const pos = v ? this.where(v) : null;

    if (obj.kind === 'star') {
      const info = obj.info;
      title = obj.name || obj.desig || `HIP ${obj.id}`;
      const con = sky.constellations.find((c) => c.id === obj.con);
      sub = info?.type || `Star in ${con?.name || 'the sky'}`;
      if (info?.dist) {
        stats += chip('Distance', fmtLy(info.dist));
        const year = new Date().getFullYear() - Math.round(info.dist);
        if (info.dist < 2500) stats += chip('Light you see left it', year > 0 ? `around ${year}` : `around ${-year + 1} BCE`);
      }
      stats += chip('Brightness', `mag ${obj.mag.toFixed(1)}`);
      if (con) stats += chip('Constellation', con.name);
      fact = info?.fact || '';
      wiki = obj.name ? info?.wiki || (obj.name.includes(' ') ? obj.name : obj.name) : null;
    } else if (obj.kind === 'constellation') {
      const info = obj.info;
      title = obj.name;
      sub = info?.en || 'One of the 88 modern constellations';
      fact = info?.fact || 'Constellations are regions of sky that astronomers use like countries on a map.';
      const brightest = sky.named.filter((s) => s.con === obj.id && s.name).sort((a, b) => a.mag - b.mag).slice(0, 4);
      if (brightest.length) extra = `<div class="si-list"><small>Brightest stars</small>${brightest.map((s) => `<button class="sky-chip" data-star="${s.id}">${escapeHtml(s.name)}</button>`).join('')}</div>`;
      wiki = constellationWiki(obj.id, obj.name);
    } else if (obj.kind === 'asterism') {
      title = obj.name;
      sub = 'Star pattern (asterism)';
      fact = obj.fact;
      wiki = obj.wiki;
    } else if (obj.kind === 'dso') {
      title = obj.name;
      sub = obj.type;
      stats += chip('Distance', fmtLy(obj.dist));
      fact = obj.fact;
      wiki = obj.wiki;
    } else if (obj.kind === 'body') {
      title = obj.name;
      const info = PLANET_INFO[obj.name];
      sub = obj.name === 'Sun' ? 'Our star' : obj.name === 'Moon' ? 'Earth’s moon' : 'Planet';
      const km = obj.dist * 149597870.7;
      const lightSec = obj.dist * 499.005;
      stats += chip('Distance', km > 1e7 ? `${(km / 1e6).toFixed(0)} million km` : `${Math.round(km).toLocaleString()} km`);
      stats += chip('Light-time', lightSec < 90 ? `${lightSec.toFixed(1)} seconds` : lightSec < 5400 ? `${(lightSec / 60).toFixed(1)} minutes` : `${(lightSec / 3600).toFixed(1)} hours`);
      if (obj.name === 'Moon') stats += chip('Illuminated', `${Math.round((obj.phase ?? 0) * 100)}%`);
      else if (obj.mag != null && obj.name !== 'Sun') stats += chip('Brightness', `mag ${obj.mag.toFixed(1)}`);
      const rs = this.riseSet(obj.name);
      if (rs.rise) stats += chip('Next rise', tfmt(rs.rise));
      if (rs.set) stats += chip('Next set', tfmt(rs.set));
      fact = info.fact + (obj.name === 'Sun' ? ' Never look directly at it.' : '');
      wiki = info.wiki;
    }

    el.innerHTML = `
      <button class="si-x" aria-label="Close">✕</button>
      <div class="si-kicker">${escapeHtml(sub)}</div>
      <h2>${escapeHtml(title)}</h2>
      ${pos ? `<div class="si-where ${pos.alt < 0 ? 'below' : ''}"><i style="transform:rotate(${sky.heading != null ? angDiff(sky.heading, pos.az) : pos.az}deg)">↑</i>${escapeHtml(pos.text)}</div>` : ''}
      ${stats ? `<div class="si-stats">${stats}</div>` : ''}
      ${fact ? `<p class="si-fact">${escapeHtml(fact)}</p>` : ''}
      ${extra}
      <div class="si-actions">
        <button class="btn" data-si="center">🎯 Center</button>
        ${wiki ? '<button class="btn ghost" data-si="story">📖 Full story</button>' : ''}
      </div>`;
    el.classList.remove('hidden');
    el.classList.remove('si-pop');
    void el.offsetWidth;
    el.classList.add('si-pop');
    $(el, '.si-x').onclick = () => { sky.select(null); };
    $(el, '[data-si=center]').onclick = () => sky.flyTo(obj);
    const story = $(el, '[data-si=story]');
    if (story) story.onclick = () => this.d.detail.openPlace({ title: wiki });
    el.querySelectorAll('[data-star]').forEach((b) => (b.onclick = () => {
      const s = sky.starById.get(+b.dataset.star);
      sky.flyTo(s);
      sky.select(s);
    }));
  }

  showCosmosInfo(hit) {
    const el = $(this.root, '#skyInfo');
    if (!hit) return el.classList.add('hidden');
    this.d.audio.sfx('select');
    let title, sub, fact, wiki, stats = '';
    const chip = (label, value) => `<div class="si-stat"><small>${label}</small><b>${value}</b></div>`;
    if (hit.name === 'SunGalactic') {
      title = 'You are here';
      sub = 'The Solar System in the Milky Way';
      fact = 'We sit in a quiet stretch between two spiral arms. The Sun carries us around the galaxy at about 230 km/s, and one lap takes roughly 230 million years. The last time we were at this point in the orbit, the first dinosaurs were appearing.';
      wiki = 'Orion Arm';
      stats = chip('From the center', '26,000 light-years') + chip('Galaxy width', '~100,000 light-years') + chip('Stars in the galaxy', '100–400 billion');
    } else if (hit.name === 'GalacticCenter') {
      const d = DSOS.find((x) => x.id === 'GC');
      title = d.name;
      sub = d.type;
      fact = d.fact;
      wiki = d.wiki;
      stats = chip('Distance', fmtLy(d.dist));
    } else {
      const info = PLANET_INFO[hit.name] || { fact: 'Our home: the only world known to have life, including Andrew & Jenna.', wiki: 'Earth' };
      title = hit.name;
      sub = hit.name === 'Sun' ? 'Our star' : 'Planet';
      fact = info.fact;
      wiki = info.wiki;
      if (hit.helio) {
        stats += chip('From the Sun', `${hit.helio.r.toFixed(2)} AU`);
        stats += chip('Sunlight takes', `${((hit.helio.r * 499.005) / 60).toFixed(1)} min`);
        if (hit.name !== 'Earth') {
          const e = Astronomy.HelioVector('Earth', this.cosmos.date), p = Astronomy.HelioVector(hit.name, this.cosmos.date);
          stats += chip('From Earth', `${Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z).toFixed(2)} AU`);
        }
      }
    }
    el.innerHTML = `
      <button class="si-x" aria-label="Close">✕</button>
      <div class="si-kicker">${escapeHtml(sub)}</div>
      <h2>${escapeHtml(title)}</h2>
      ${stats ? `<div class="si-stats">${stats}</div>` : ''}
      <p class="si-fact">${escapeHtml(fact)}</p>
      <div class="si-actions"><button class="btn ghost" data-si="story">📖 Full story</button></div>`;
    el.classList.remove('hidden', 'si-pop');
    void el.offsetWidth;
    el.classList.add('si-pop');
    $(el, '.si-x').onclick = () => { el.classList.add('hidden'); this.cosmos.selected = null; };
    $(el, '[data-si=story]').onclick = () => this.d.detail.openPlace({ title: wiki });
  }

  // Cosmic speedometer: how fast you're really moving
  renderSpeedo() {
    const el = $(this.root, '#skySpeedo');
    const fix = this.d.getFix();
    const lat = fix?.lat ?? this.sky?.lat ?? 40;
    const metric = this.d.metric();
    const carMs = fix?.speed || 0;
    const rows = [
      ['🚘', 'Your car', carMs],
      ['🌍', 'Earth spinning (here)', 465.1 * Math.cos((lat * Math.PI) / 180)],
      ['☀️', 'Earth around the Sun', 29780],
      ['🌌', 'Sun around the galaxy', 230000],
    ];
    const fmt = (ms) => (metric ? `${Math.round(ms * 3.6).toLocaleString()} km/h` : `${Math.round(ms * 2.23694).toLocaleString()} mph`);
    const opened = this.openedAt || (this.openedAt = Date.now());
    const km = ((Date.now() - opened) / 1000) * 230;
    el.innerHTML = `<b>Cosmic speedometer</b>${rows
      .map(([i, l, v]) => `<div class="sp-row"><span>${i} ${l}</span><em>${fmt(v)}</em><i style="width:${Math.max(2, (Math.log10(v + 1) / Math.log10(230001)) * 100)}%"></i></div>`)
      .join('')}<div class="sp-foot">Since opening the sky you've traveled <b>${Math.round(km).toLocaleString()} km</b> around the galaxy.</div>`;
  }
}
