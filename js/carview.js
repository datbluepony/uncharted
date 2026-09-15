// Car screen: a live, animated view of what the browser can tell about the
// car and the drive — speed, heading, g-forces, estimated energy, nearest
// Superchargers, onboard computer, connectivity, elevation and the sky.
import { escapeHtml, fmtDist, fmtSpeed, fmtDuration, settings, bearing, clamp } from './util.js';
import { TRIMS } from './tesla.js';

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (h) => CARDINALS[Math.round(((h % 360) + 360) % 360 / 45) % 8];
const ARC_R = 262;
const ARC_LEN = 2 * Math.PI * ARC_R * 0.75;

function spark(values, w, h) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  return v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - ((x - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ');
}

export class CarView {
  constructor(deps) {
    this.d = deps;
    this.raf = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.probeTimer);
    this.raf = null;
    this.root = null;
  }

  render(root) {
    this.dispose();
    this.root = root;
    const car = this.d.car;
    const trim = TRIMS[settings.get().trim] || TRIMS.lr;
    const ticks = Array.from({ length: 72 }, (_, i) => {
      const long = i % 9 === 0;
      return `<line x1="300" y1="${long ? 14 : 20}" x2="300" y2="30" transform="rotate(${i * 5} 300 320)" class="${long ? 'tk-l' : 'tk'}"/>`;
    }).join('');
    const letters = ['N', 'E', 'S', 'W'].map((l, i) => `<text x="300" y="52" transform="rotate(${i * 90} 300 320)" class="${l === 'N' ? 'cmp-n' : 'cmp'}">${l}</text>`).join('');

    root.innerHTML = `
    <div class="car-grid">
      <section class="car-stage">
        <div class="car-ident">
          <span class="pulse-dot ${car.isTesla ? 'ok' : ''}"></span>
          <div><b>${car.isTesla ? 'Tesla detected' : 'Preview mode'}</b>
          <small>Model 3 ${escapeHtml(trim.label)} · 2022–2023${car.version ? ` · v${escapeHtml(car.version)}` : ''}</small></div>
        </div>
        <svg class="car-svg" viewBox="0 0 600 640" aria-hidden="true">
          <defs>
            <linearGradient id="cvPaint" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#1a2230"/><stop offset="0.5" stop-color="#3b485c"/><stop offset="1" stop-color="#1a2230"/>
            </linearGradient>
            <linearGradient id="cvGlass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#0a1220"/><stop offset="0.5" stop-color="#1d3150"/><stop offset="1" stop-color="#0a1220"/>
            </linearGradient>
            <linearGradient id="cvBeam" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stop-color="#dff4ff" stop-opacity="0.55"/><stop offset="1" stop-color="#dff4ff" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="cvArc" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stop-color="#3fb6ff"/><stop offset="1" stop-color="#7cf7d4"/>
            </linearGradient>
            <radialGradient id="cvGlow"><stop offset="0" stop-color="#3fb6ff" stop-opacity="0.7"/><stop offset="1" stop-color="#3fb6ff" stop-opacity="0"/></radialGradient>
            <filter id="cvBlur"><feGaussianBlur stdDeviation="6"/></filter>
            <clipPath id="cvClip"><circle cx="300" cy="320" r="236"/></clipPath>
          </defs>

          <g id="cvCompass" class="cv-compass">${ticks}${letters}</g>
          <circle cx="300" cy="320" r="${ARC_R}" class="arc-bg" stroke-dasharray="${ARC_LEN} 9999" transform="rotate(135 300 320)"/>
          <circle id="cvArc" cx="300" cy="320" r="${ARC_R}" class="arc-fg" stroke-dasharray="0 9999" transform="rotate(135 300 320)"/>
          <circle cx="300" cy="320" r="236" class="stage-bg"/>

          <g clip-path="url(#cvClip)">
            <rect x="160" y="60" width="280" height="520" class="road"/>
            <line id="cvLaneL" x1="205" y1="60" x2="205" y2="580" class="lane"/>
            <line id="cvLaneR" x1="395" y1="60" x2="395" y2="580" class="lane"/>
            <line x1="165" y1="60" x2="165" y2="580" class="edge"/>
            <line x1="435" y1="60" x2="435" y2="580" class="edge"/>
            <g id="cvStreaks" opacity="0">
              ${[190, 225, 375, 410].map((x, i) => `<line x1="${x}" y1="${80 + i * 60}" x2="${x}" y2="${180 + i * 60}" class="streak"/>`).join('')}
            </g>
          </g>

          <ellipse id="cvUnder" cx="300" cy="325" rx="110" ry="190" fill="url(#cvGlow)" opacity="0.3"/>
          <path id="cvBeams" d="M262 176 L200 40 L292 40 L292 176 Z M338 176 L308 40 L400 40 L338 176 Z" fill="url(#cvBeam)" opacity="0"/>

          <g class="wheels">
            ${[[214, 196], [374, 196], [214, 402], [374, 402]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="14" height="46" rx="4" class="tire"/><line id="cvTread${i}" x1="${x + 7}" y1="${y + 3}" x2="${x + 7}" y2="${y + 43}" class="tread"/>`).join('')}
          </g>
          <path class="body" d="M300 165 C350 165 368 185 370 215 L372 300 C374 360 372 420 366 455 C360 478 340 484 300 484 C260 484 240 478 234 455 C228 420 226 360 228 300 L230 215 C232 185 250 165 300 165 Z"/>
          <path class="glassroof" d="M300 238 C336 238 346 250 348 275 L348 400 C346 425 334 434 300 434 C266 434 254 425 252 400 L252 275 C254 250 264 238 300 238 Z"/>
          <path id="cvShine" class="shine" d="M262 250 L280 250 L262 420 L252 420 Z"/>
          <ellipse cx="222" cy="262" rx="10" ry="6" class="mirror"/>
          <ellipse cx="378" cy="262" rx="10" ry="6" class="mirror"/>
          <path class="headlight" d="M248 190 Q262 178 282 176"/><path class="headlight" d="M352 190 Q338 178 318 176"/>
          <path id="cvTail" class="taillight" d="M244 470 Q300 482 356 470"/>

          <g transform="translate(300 320)">
            <circle r="46" class="gm-ring"/><circle r="23" class="gm-ring2"/>
            <line x1="-46" y1="0" x2="46" y2="0" class="gm-axis"/><line x1="0" y1="-46" x2="0" y2="46" class="gm-axis"/>
            <circle id="cvGdot" r="7" class="gm-dot"/>
          </g>
        </svg>
        <div class="car-readout left"><b id="cvSpeed">0</b><span id="cvSpeedUnit">mph</span></div>
        <div class="car-readout right"><b id="cvHeading">—</b><span id="cvHeadingDeg">heading</span></div>
        <div class="car-readout bottom"><span id="cvG">0.00 g</span><span id="cvPower">0 kW</span></div>
      </section>

      <section class="car-cards">
        <div class="cc cc-wide">
          <h3>⚡ Energy <small>estimated for your ${escapeHtml(trim.label)}</small></h3>
          <div class="en-row">
            <svg viewBox="0 0 120 120" class="en-ring"><circle cx="60" cy="60" r="50" class="en-bg"/><circle id="cvEnRing" cx="60" cy="60" r="50" class="en-fg" stroke-dasharray="0 999" transform="rotate(-90 60 60)"/>
              <text x="60" y="58" id="cvWhmi" class="en-big">—</text><text x="60" y="78" class="en-small">Wh/mi</text></svg>
            <div class="en-stats">
              <div><small>Used this drive</small><b id="cvKwh">0.00 kWh</b></div>
              <div><small>Recovered by regen</small><b id="cvRegen">0.00 kWh</b></div>
              <div><small>Battery used</small><b id="cvBatt">0.0%</b></div>
              <div><small>Range at this pace</small><b id="cvRange">—</b></div>
            </div>
          </div>
          <div class="kw-bar"><i class="kw-zero"></i><i id="cvKwFill" class="kw-fill"></i><span>Regen</span><span>Power</span></div>
        </div>

        <div class="cc">
          <h3>🔌 Nearest Superchargers</h3>
          <div id="cvSC" class="sc-list"><p class="muted">Loading the Supercharger map…</p></div>
        </div>

        <div class="cc">
          <h3>🧠 Onboard computer</h3>
          <div class="kv"><small>Computer</small><b>${escapeHtml(car.computer)}</b></div>
          <div class="kv"><small>CPU threads</small><b><span class="cores">${Array.from({ length: car.threads || 0 }, (_, i) => `<i style="animation-delay:${i * 0.12}s"></i>`).join('')}</span> ${car.threads || '—'}</b></div>
          <div class="kv"><small>Graphics</small><b class="clip">${escapeHtml(car.gpu || '—')}</b></div>
          <div class="kv"><small>Display</small><b>${car.screen} @${car.dpr}x · ${car.touch ? car.touch + '-point touch' : 'no touch'}</b></div>
          <div class="kv"><small>Browser</small><b>Chromium ${car.chromium || '—'} · ${escapeHtml(car.platform)}</b></div>
        </div>

        <div class="cc">
          <h3>🚘 Software</h3>
          ${car.isTesla ? `
            <div class="ver-big">${escapeHtml(car.version)}</div>
            <div class="kv"><small>Released</small><b>${car.released || '—'}${car.holiday ? ' · 🎄 Holiday update' : ''}</b></div>
            <div class="kv"><small>Build</small><b class="mono">${escapeHtml(car.build || '—')}</b></div>`
          : `<div class="ver-big muted">Not in a Tesla</div><p class="muted small">Open Uncharted in the Model 3's browser to read the car's software version and computer.</p>`}
          <div class="kv"><small>Time zone</small><b>${escapeHtml(car.timezone)}</b></div>
        </div>

        <div class="cc">
          <h3>📡 Connectivity</h3>
          <div class="kv"><small>Status</small><b id="cvOnline">—</b></div>
          <div class="kv"><small>Network</small><b id="cvNet">—</b></div>
          <div class="kv"><small>Latency</small><b id="cvLat">—</b></div>
          <svg viewBox="0 0 220 44" class="spark"><polyline id="cvLatSpark"/></svg>
        </div>

        <div class="cc">
          <h3>🛰️ Position</h3>
          <div class="kv"><small>Coordinates</small><b id="cvPos" class="mono">—</b></div>
          <div class="kv"><small>GPS precision</small><b id="cvAcc">—</b></div>
          <div class="kv"><small>Elevation</small><b id="cvElev">—</b></div>
          <svg viewBox="0 0 220 44" class="spark"><polyline id="cvElevSpark"/></svg>
        </div>

        <div class="cc">
          <h3>🌅 Sky</h3>
          <svg viewBox="0 0 220 96" class="sky-arc">
            <path d="M14 86 A96 76 0 0 1 206 86" class="sky-path"/>
            <line x1="6" y1="86" x2="214" y2="86" class="sky-horizon"/>
            <circle id="cvSun" r="8" cx="14" cy="86" class="sky-sun"/>
          </svg>
          <div class="kv"><small>Sunrise · Sunset</small><b id="cvSunTimes">—</b></div>
          <div class="kv"><small>Outside</small><b id="cvWx">—</b></div>
        </div>

        <div class="cc">
          <h3>⏱️ This session</h3>
          <div class="kv"><small>Time</small><b id="cvSess">—</b></div>
          <div class="kv"><small>Distance</small><b id="cvSessDist">—</b></div>
          <div class="kv"><small>Top speed</small><b id="cvTop">—</b></div>
          <div class="kv"><small>Explored</small><b id="cvExpl">—</b></div>
        </div>
      </section>
    </div>`;

    const q = (id) => root.querySelector('#' + id);
    this.el = {};
    for (const id of ['cvCompass', 'cvArc', 'cvLaneL', 'cvLaneR', 'cvStreaks', 'cvUnder', 'cvBeams', 'cvTail', 'cvGdot', 'cvSpeed', 'cvSpeedUnit', 'cvHeading', 'cvHeadingDeg', 'cvG', 'cvPower', 'cvShine',
      'cvEnRing', 'cvWhmi', 'cvKwh', 'cvRegen', 'cvBatt', 'cvRange', 'cvKwFill', 'cvSC', 'cvOnline', 'cvNet', 'cvLat', 'cvLatSpark', 'cvPos', 'cvAcc', 'cvElev', 'cvElevSpark', 'cvSun', 'cvSunTimes', 'cvWx', 'cvSess', 'cvSessDist', 'cvTop', 'cvExpl']) {
      this.el[id] = q(id);
    }
    this.treads = [0, 1, 2, 3].map((i) => q('cvTread' + i));
    this.s = { speed: 0, heading: 0, lane: 0, gx: 0, gy: 0, last: performance.now(), lastCards: 0, t: 0 };
    this.d.conn.probe();
    this.probeTimer = setInterval(() => this.d.conn.probe(), 15000);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(t) {
    if (!this.root || !document.body.contains(this.root)) return this.dispose();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.s.last) / 1000);
    if (dt < 0.03) return;
    this.s.last = t;
    this.s.t += dt;
    const { el, s, d } = this;
    const fix = d.getFix();
    const glass = d.glass;

    // Smooth speed and heading
    s.speed += ((fix?.speed || 0) - s.speed) * Math.min(1, dt * 3);
    if (fix?.heading != null) {
      const diff = ((fix.heading - s.heading + 540) % 360) - 180;
      s.heading = (s.heading + diff * Math.min(1, dt * 3) + 360) % 360;
    }
    const mph = s.speed * 2.23694;
    el.cvArc.setAttribute('stroke-dasharray', `${(ARC_LEN * clamp(mph / 100, 0, 1)).toFixed(1)} 9999`);
    el.cvCompass.setAttribute('transform', `rotate(${-s.heading} 300 320)`);

    // Road and wheels move with speed
    s.lane = (s.lane + s.speed * dt * 14) % 600;
    el.cvLaneL.style.strokeDashoffset = el.cvLaneR.style.strokeDashoffset = -s.lane;
    for (const tr of this.treads) tr.style.strokeDashoffset = -((s.lane * 3) % 100);
    el.cvStreaks.setAttribute('opacity', clamp((mph - 35) / 40, 0, 0.8).toFixed(2));
    el.cvStreaks.style.transform = `translateY(${(s.lane * 2) % 120}px)`;
    el.cvUnder.setAttribute('opacity', (0.25 + clamp(mph / 80, 0, 0.6) + 0.08 * Math.sin(s.t * 3)).toFixed(2));
    el.cvShine.style.transform = `translateX(${((s.t * 30) % 140) - 20}px)`;

    // Lights: beams when moving (brighter at night), brake light on deceleration
    const sun = d.place.sun;
    const night = sun && !isNaN(sun.sunset) && (Date.now() > sun.sunset || Date.now() < sun.sunrise);
    el.cvBeams.setAttribute('opacity', mph > 1 ? (night ? 0.9 : 0.4) : night ? 0.35 : 0.08);
    const braking = glass.aLong < -0.8;
    el.cvTail.classList.toggle('brake', braking);

    // G-meter: dot moves toward the force you feel
    const gx = clamp(-glass.aLat / 9.81 / 0.5, -1, 1) * 40;
    const gy = clamp(glass.aLong / 9.81 / 0.5, -1, 1) * 40;
    s.gx += (gx - s.gx) * Math.min(1, dt * 6);
    s.gy += (gy - s.gy) * Math.min(1, dt * 6);
    el.cvGdot.setAttribute('cx', s.gx.toFixed(1));
    el.cvGdot.setAttribute('cy', s.gy.toFixed(1));

    if (t - s.lastCards > 500) {
      s.lastCards = t;
      this.cards(fix, mph);
    }
  }

  cards(fix, mph) {
    const { el, d } = this;
    const metric = settings.get().units === 'metric';
    el.cvSpeed.textContent = fmtSpeed(this.s.speed);
    el.cvSpeedUnit.textContent = metric ? 'km/h' : 'mph';
    el.cvHeading.textContent = fix?.heading != null ? cardinal(this.s.heading) : '—';
    el.cvHeadingDeg.textContent = fix?.heading != null ? `${Math.round(this.s.heading)}°` : 'heading';
    const g = Math.hypot(d.glass.aLat, d.glass.aLong) / 9.81;
    el.cvG.textContent = `${g.toFixed(2)} g`;

    // Energy
    const e = d.getEnergy();
    if (e) {
      const ratio = e.whPerMile ? e.whPerMile / e.rated : 0;
      el.cvWhmi.textContent = e.whPerMile ? Math.round(metric ? e.whPerMile / 1.609 : e.whPerMile) : '—';
      el.cvEnRing.setAttribute('stroke-dasharray', `${(314 * clamp(ratio / 2, 0, 1)).toFixed(1)} 999`);
      el.cvEnRing.style.stroke = !e.whPerMile ? '#3fb6ff' : ratio < 0.95 ? '#5de38b' : ratio < 1.15 ? '#ffb547' : '#ff5a6a';
      el.cvKwh.textContent = `${e.kwh.toFixed(2)} kWh`;
      el.cvRegen.textContent = `${e.regenKwh.toFixed(2)} kWh`;
      el.cvBatt.textContent = `${e.batteryPct.toFixed(1)}%`;
      el.cvRange.textContent = e.rangeAtThis ? fmtDist(e.rangeAtThis * 1609.344) : '—';
      el.cvPower.textContent = `${e.kw >= 0 ? '' : '−'}${Math.abs(e.kw).toFixed(0)} kW`;
      const kw = clamp(e.kw, -70, 150);
      el.cvKwFill.style.left = kw >= 0 ? '31.8%' : `${31.8 + (kw / 70) * 31.8}%`;
      el.cvKwFill.style.width = `${(Math.abs(kw) / (kw >= 0 ? 150 : 70)) * (kw >= 0 ? 68.2 : 31.8)}%`;
      el.cvKwFill.classList.toggle('regen', kw < 0);
    }

    // Superchargers
    const sc = d.superchargers;
    if (fix && sc.sites.length) {
      const list = sc.nearby.length ? sc.nearby : sc.nearest(fix.lat, fix.lon, 3);
      el.cvSC.innerHTML = list.map((x) => {
        const rot = bearing(fix.lat, fix.lon, x.lat, x.lon) - (fix.heading ?? 0);
        return `<div class="sc"><i class="sc-arrow" style="transform:rotate(${rot.toFixed(0)}deg)">↑</i>
          <div><b>${escapeHtml(x.name)}</b><small>${x.stalls || '?'} stalls${x.kw ? ` · ${x.kw} kW` : ''}</small></div><span>${fmtDist(x.meters)}</span></div>`;
      }).join('');
    } else if (!sc.sites.length) {
      el.cvSC.innerHTML = `<p class="muted">${sc.loading ? 'Downloading the Supercharger map (one time)…' : 'Supercharger map unavailable offline.'}</p>`;
    } else {
      el.cvSC.innerHTML = '<p class="muted">Waiting for location…</p>';
    }

    // Connectivity
    const n = d.conn.snapshot();
    el.cvOnline.innerHTML = n.online ? '<span class="ok-txt">● Online</span>' : '<span class="bad-txt">● Offline</span>';
    el.cvNet.textContent = [n.type?.toUpperCase(), n.downlink != null ? `${n.downlink} Mbps` : null].filter(Boolean).join(' · ') || 'Not reported';
    el.cvLat.textContent = n.latency != null ? `${n.latency} ms` : '—';
    el.cvLatSpark.setAttribute('points', spark(n.history, 220, 44));

    // Position
    if (fix) {
      el.cvPos.textContent = `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}`;
      el.cvAcc.textContent = `±${Math.round(metric ? fix.acc : fix.acc * 3.28084)} ${metric ? 'm' : 'ft'} · ${fix.rate ? fix.rate.toFixed(1) : '—'} Hz`;
    }
    const elev = d.elevation;
    if (elev.meters != null) {
      el.cvElev.textContent = `${Math.round(metric ? elev.meters : elev.meters * 3.28084).toLocaleString()} ${metric ? 'm' : 'ft'} · ${elev.source}`;
      el.cvElevSpark.setAttribute('points', spark(elev.profile.map((p) => p[1]), 220, 44));
    }

    // Sky
    const sun = d.place.sun;
    if (sun && !isNaN(sun.sunset)) {
      const now = Date.now();
      const f = clamp((now - sun.sunrise) / (sun.sunset - sun.sunrise), 0, 1);
      const ang = Math.PI * (1 - f);
      el.cvSun.setAttribute('cx', (110 + 96 * Math.cos(ang)).toFixed(1));
      el.cvSun.setAttribute('cy', (86 - 76 * Math.sin(ang)).toFixed(1));
      el.cvSun.classList.toggle('moon', now < sun.sunrise || now > sun.sunset);
      const tf = (x) => x.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      el.cvSunTimes.textContent = `${tf(sun.sunrise)} · ${tf(sun.sunset)}`;
    }
    const w = d.place.weather;
    if (w) el.cvWx.textContent = `${w.icon} ${Math.round(metric ? ((w.tempF - 32) * 5) / 9 : w.tempF)}° · ${w.label} · wind ${Math.round(metric ? w.windMph * 1.609 : w.windMph)} ${metric ? 'km/h' : 'mph'}`;

    // Session
    const ss = d.session;
    ss.top = Math.max(ss.top || 0, mph);
    el.cvSess.textContent = fmtDuration(Date.now() - ss.start);
    el.cvSessDist.textContent = fmtDist(ss.meters);
    el.cvTop.textContent = `${Math.round(metric ? ss.top * 1.609 : ss.top)} ${metric ? 'km/h' : 'mph'}`;
    el.cvExpl.textContent = `${d.fog.areaKm2.toFixed(2)} km² total`;
  }
}
