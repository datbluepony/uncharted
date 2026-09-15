// The live sky. WebGL draws the sky dome (twilight, sun/moon glow, a
// procedural Milky Way, the ground) in one full-screen pass, and every star
// as a GPU point projected in the vertex shader, so panning costs almost no
// CPU. A 2D canvas on top draws constellation lines, asterisms, planets, the
// Moon's phase, labels, the horizon compass and the selection reticle.
//
// Coordinates: catalog = J2000 equatorial unit vectors. R turns them into the
// local East-North-Up frame (depends on sidereal time + latitude), V turns ENU
// into the camera frame, and a stereographic projection maps to the screen.
/* global Astronomy */
import { STAR_INFO, CONST_INFO, ASTERISMS, DSOS, PLANET_INFO, PLANETS } from './skydata.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap360 = (a) => ((a % 360) + 360) % 360;
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

// J2000 equatorial → galactic
const GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.44482963, 0.7469822445, -0.867666149, -0.1980763734, 0.4559837762];

function eqVec(raDeg, decDeg) {
  const ra = raDeg * D2R, dec = decDeg * D2R;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

// Approximate star color from B-V index, gently desaturated.
function bvToRgb(bv) {
  bv = clamp(Number.isFinite(bv) ? bv : 0.6, -0.4, 2.0);
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  let r, g, b;
  if (k <= 66) {
    r = 255;
    g = 99.47 * Math.log(k) - 161.12;
    b = k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(k - 60, -0.1332);
    g = 288.12 * Math.pow(k - 60, -0.0755);
    b = 255;
  }
  const c = [r, g, b].map((x) => clamp(x, 0, 255) / 255);
  const avg = (c[0] + c[1] + c[2]) / 3;
  return c.map((x) => avg + (x - avg) * 0.65);
}

// ---------------- Shaders ----------------
const SKY_VS = `
attribute vec2 aPos;
varying vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SKY_FS = `
precision highp float;
varying vec2 vNdc;
uniform vec2 uInv;      // ndc → projection-plane units
uniform mat3 uVt;       // camera → ENU
uniform mat3 uRt;       // ENU → equatorial
uniform mat3 uGal;      // equatorial → galactic
uniform vec3 uSun;      // sun direction (ENU)
uniform vec3 uMoon;     // moon direction (ENU)
uniform float uMoonLit; // 0..1
uniform float uMW;      // milky way strength
uniform float uNight;   // red night-vision mode
uniform float uTime;
uniform sampler2D uMWTex; // pre-rendered Milky Way in galactic lon/lat

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

void main() {
  vec2 p = vNdc * uInv;
  float r2 = dot(p, p);
  vec3 q = vec3(4.0 * p, 4.0 - r2) / (4.0 + r2);
  vec3 h = uVt * q;                 // E, N, U
  float alt = h.z;

  float sunAlt = uSun.z;
  float day = smoothstep(-0.2, 0.08, sunAlt);
  float twilight = smoothstep(-0.32, -0.04, sunAlt) * (1.0 - smoothstep(-0.02, 0.2, sunAlt));
  float cosSun = dot(h, uSun);
  float cosMoon = dot(h, uMoon);

  // Night sky with a faint airglow toward the horizon
  vec3 col = vec3(0.006, 0.010, 0.024);
  col += vec3(0.018, 0.030, 0.060) * (1.0 - smoothstep(0.0, 0.45, abs(alt)));
  // Day and twilight
  vec3 dayCol = mix(vec3(0.32, 0.55, 0.92), vec3(0.12, 0.30, 0.72), smoothstep(0.0, 0.8, alt));
  col = mix(col, dayCol, day * 0.85);
  col += vec3(1.0, 0.42, 0.18) * twilight * pow(max(cosSun, 0.0), 2.5) * (1.0 - smoothstep(0.0, 0.5, alt)) * 0.9;
  col += vec3(0.30, 0.22, 0.45) * twilight * (1.0 - smoothstep(0.0, 0.7, alt)) * 0.25;
  // Sun and Moon glow
  col += vec3(1.0, 0.85, 0.6) * exp((cosSun - 1.0) * 900.0) * step(-0.02, sunAlt) * 2.0;
  col += vec3(1.0, 0.9, 0.7) * exp((cosSun - 1.0) * 40.0) * day * 0.35;
  col += vec3(0.75, 0.8, 0.95) * exp((cosMoon - 1.0) * 300.0) * uMoonLit * 0.12 * step(-0.02, uMoon.z);

  // Milky Way: one texture lookup in galactic coordinates
  if (uMW > 0.0) {
    vec3 g = uGal * (uRt * h);
    float b = asin(clamp(g.z, -1.0, 1.0));
    float l = atan(g.y, g.x);
    vec3 mw = texture2D(uMWTex, vec2(l / 6.2831853 + 0.5, b / 3.14159265 + 0.5)).rgb * 3.2;
    float moonWash = 1.0 - 0.6 * uMoonLit * step(0.0, uMoon.z);
    col += mw * 0.16 * uMW * (1.0 - day) * moonWash * smoothstep(-0.02, 0.2, alt);
  }

  // Ground below the horizon
  if (alt < 0.0) {
    vec3 ground = mix(vec3(0.014, 0.017, 0.024), vec3(0.004, 0.005, 0.008), smoothstep(0.0, 0.5, -alt));
    ground = mix(ground, vec3(0.05, 0.07, 0.09), day * 0.5);
    col = ground + vec3(0.10, 0.16, 0.26) * exp(alt * 80.0) * 0.35;
  }
  col += vec3(0.25, 0.45, 0.75) * exp(-abs(alt) * 220.0) * 0.25; // horizon line glow

  if (uNight > 0.5) col = vec3(dot(col, vec3(0.35, 0.55, 0.1)) * 1.4, 0.0, 0.0);
  col += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0; // dither
  gl_FragColor = vec4(col, 1.0);
}`;

// Rendered once into a 2048×1024 galactic equirectangular texture: the band,
// the bright bulge toward Sagittarius, cloudy structure and the dark rift.
const MW_FS = `
precision highp float;
varying vec2 vNdc;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  float l = (uv.x * 2.0 - 1.0) * 3.14159265;
  float b = (uv.y - 0.5) * 3.14159265;
  vec3 g = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
  float cl = cos(l);
  float band = exp(-pow(b / 0.2, 2.0)) * 0.8 + exp(-pow(b / 0.5, 2.0)) * 0.2;
  float core = 1.0 + 1.6 * pow(max(cl, 0.0), 3.0);
  float clouds = fbm(g * 7.0 + 3.1);
  float lane = 1.0 - 0.7 * exp(-pow((b + 0.015) / 0.035, 2.0)) * smoothstep(0.35, 0.7, fbm(g * 3.0 + 9.0)) * step(0.0, cl);
  float mw = band * core * (0.35 + 0.85 * clouds * clouds) * lane;
  vec3 mwCol = mix(vec3(0.55, 0.62, 0.8), vec3(0.95, 0.82, 0.62), clamp(pow(max(cl, 0.0), 2.0) * exp(-pow(b / 0.15, 2.0)), 0.0, 1.0));
  gl_FragColor = vec4(clamp(mwCol * mw / 3.2, 0.0, 1.0), 1.0);
}`;

// Stars are drawn as small quads (6 vertices each) rather than GL points,
// because many GPUs/drivers cap gl_PointSize to a few pixels.
const STAR_VS = `
attribute vec3 aPos;
attribute vec4 aData; // r, g, b, mag
attribute float aPhase;
attribute vec2 aCorner; // -1..1
uniform vec2 uPixel;    // 2 / drawing-buffer size
varying vec2 vUv;
uniform mat3 uM;
uniform vec3 uUp;
uniform vec2 uScale;
uniform float uLim;
uniform float uSizeK;
uniform float uTime;
uniform float uDay;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
varying float vSpike;
void main() {
  vec3 q = uM * aPos;
  vUv = aCorner;
  if (q.z < -0.25) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); vSpike = 0.0; return; }
  float k = 2.0 / (1.0 + q.z);
  float u = dot(uUp, aPos);
  float fade = smoothstep(-0.01, 0.1, u);
  float mag = aData.a;
  float b = clamp((uLim - mag) / (uLim + 1.6), 0.0, 1.0);
  float tw = 1.0 + 0.22 * sin(uTime * (1.7 + aPhase * 3.1) + aPhase * 60.0) * (1.0 - smoothstep(0.05, 0.6, u));
  // Bright stars get big soft glows; faint ones stay crisp pinpoints.
  float size = (3.5 + 42.0 * pow(b, 2.0)) * uSizeK * uPx * (0.94 + 0.06 * tw);
  gl_Position = vec4(q.xy * k * uScale + aCorner * size * 0.5 * uPixel, 0.0, 1.0);
  vAlpha = clamp(0.32 + b * 1.5, 0.0, 1.0) * fade * tw * (1.0 - uDay * 0.97);
  vSpike = smoothstep(1.2, -0.8, mag); // diffraction spikes only on the brightest
  vColor = aData.rgb;
}`;

const STAR_FS = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vSpike;
varying vec2 vUv;
uniform float uNight;
void main() {
  vec2 p = vUv * 0.5;
  float d = length(vUv);
  if (d > 1.0) discard;
  float edge = 1.0 - d;                            // reaches zero at the quad edge
  float core = exp(-d * d * 10.0) * 1.5;           // bright disc (~30% of the quad)
  float glow = exp(-d * d * 2.2) * 0.55 * edge;    // soft halo out to the edge
  float spike = (exp(-abs(p.x) * 70.0) + exp(-abs(p.y) * 70.0)) * edge * edge * 0.7 * vSpike;
  float a = (core + glow + spike) * vAlpha;
  vec3 c = mix(vColor, vec3(1.0), clamp(core * 0.7, 0.0, 1.0));
  if (uNight > 0.5) c = vec3(dot(c, vec3(0.35, 0.55, 0.1)) * 1.3, 0.0, 0.0);
  gl_FragColor = vec4(c * a, 0.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// ---------------- SkyView ----------------
export class SkyView {
  constructor(container, { onSelect, onCamera } = {}) {
    this.el = container;
    this.onSelect = onSelect;
    this.onCamera = onCamera;
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'sky-gl';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sky-2d';
    container.append(this.glCanvas, this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.cam = { az: 0, alt: 28, fov: 95 };
    this.target = null; // {az, alt, fov} slew target
    this.vel = { az: 0, alt: 0 };
    this.lock = true;
    this.heading = null;
    this.lat = 42.36;
    this.lon = -71.06;
    this.timeOffset = 0;
    this.layers = { lines: true, labels: true, asterisms: true, planets: true, milkyway: true, grid: false, night: false };
    this.selected = null;
    this.running = false;
    this.bodies = [];
    this.lastBodies = 0;
    this.pointers = new Map();

    this.initGL();
    this.bindInput();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
  }

  // ---------- data ----------
  setData({ stars, names, lines, consts }) {
    const n = stars.features.length;
    const VPS = 6; // vertices per star quad
    const CORNERS = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    const pos = new Float32Array(n * VPS * 3);
    const data = new Float32Array(n * VPS * 4);
    const phase = new Float32Array(n * VPS);
    const corner = new Float32Array(n * VPS * 2);
    this.starById = new Map();
    this.named = [];
    stars.features.forEach((f, i) => {
      const [ra, dec] = f.geometry.coordinates;
      const v = eqVec(ra, dec);
      const mag = f.properties.mag;
      const rgbm = [...bvToRgb(parseFloat(f.properties.bv)), mag];
      const ph = Math.random();
      for (let k = 0; k < VPS; k++) {
        const j = i * VPS + k;
        pos.set(v, j * 3);
        data.set(rgbm, j * 4);
        phase[j] = ph;
        corner[j * 2] = CORNERS[k * 2];
        corner[j * 2 + 1] = CORNERS[k * 2 + 1];
      }
      const nm = names[f.id];
      const info = STAR_INFO[f.id];
      const star = { kind: 'star', id: f.id, v, mag, name: info?.name || nm?.name || '', desig: nm ? `${nm.desig || ''} ${nm.c || ''}`.trim() : '', con: nm?.c, info };
      this.starById.set(f.id, star);
      if ((star.name && mag < 4.5) || mag < 2.5) this.named.push(star);
    });
    this.starCount = n;
    this.starVerts = n * VPS;
    const gl = this.gl;
    if (gl) {
      const up = (buf, arr) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); };
      up(this.bufPos, pos);
      up(this.bufData, data);
      up(this.bufPhase, phase);
      up(this.bufCorner, corner);
    }

    // Constellation lines as flat arrays of unit-vector pairs
    this.constellations = consts.features.map((c) => {
      const lf = lines.features.find((l) => l.id === c.id);
      const segs = [];
      for (const line of lf?.geometry.coordinates || []) {
        for (let i = 1; i < line.length; i++) segs.push(eqVec(...line[i - 1]), eqVec(...line[i]));
      }
      const d = c.properties.display || [...c.geometry.coordinates, 20];
      return { kind: 'constellation', id: c.id, name: c.properties.name, rank: +c.properties.rank || 3, label: eqVec(d[0], d[1]), size: d[2], segs, info: CONST_INFO[c.id] };
    });

    this.asterisms = ASTERISMS.map((a) => {
      const segs = [];
      const pts = [];
      for (const [h1, h2] of a.lines) {
        const s1 = this.starById.get(h1), s2 = this.starById.get(h2);
        if (s1 && s2) { segs.push(s1.v, s2.v); pts.push(s1.v, s2.v); }
      }
      const c = pts.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]);
      const len = Math.hypot(...c) || 1;
      return { kind: 'asterism', ...a, segs, center: c.map((x) => x / len) };
    });

    this.dsos = DSOS.map((d) => ({ kind: 'dso', ...d, v: eqVec(d.ra, d.dec) }));
    this.ready = true;
  }

  setObserver(lat, lon) {
    this.lat = lat;
    this.lon = lon;
    this.lastBodies = 0;
  }

  setHeading(h) {
    this.heading = h;
  }

  get date() {
    return new Date(Date.now() + this.timeOffset);
  }

  // ---------- GL ----------
  initGL() {
    const gl = this.glCanvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    this.gl = gl;
    if (!gl) return;
    this.skyProg = compile(gl, SKY_VS, SKY_FS);
    this.starProg = compile(gl, STAR_VS, STAR_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.bufPos = gl.createBuffer();
    this.bufData = gl.createBuffer();
    this.bufPhase = gl.createBuffer();
    this.bufCorner = gl.createBuffer();
    this.bakeMilkyWay();
    this.glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.gl = null; });
  }

  // One-time render of the Milky Way into a texture so each frame is a lookup.
  bakeMilkyWay() {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const w = Math.min(2048, max), h = w / 2;
    const prog = compile(gl, SKY_VS, MW_FS);
    this.mwTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.mwTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mwTex, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(prog.p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(prog.p);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.dpr = dpr;
    this.W = w;
    this.H = h;
    for (const c of [this.glCanvas, this.canvas]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    if (this.gl) this.gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
  }

  // ---------- matrices ----------
  computeMatrices() {
    const date = this.date;
    const lst = (Astronomy.SiderealTime(date) * 15 + this.lon) * D2R;
    const lat = this.lat * D2R;
    const cL = Math.cos(lst), sL = Math.sin(lst), cP = Math.cos(lat), sP = Math.sin(lat);
    // equatorial → ENU (rows E, N, U)
    const R = [-sL, cL, 0, -cL * sP, -sL * sP, cP, cL * cP, sL * cP, sP];
    const az = this.cam.az * D2R, alt = this.cam.alt * D2R;
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(alt), se = Math.sin(alt);
    // ENU → camera (rows right, up, forward)
    const V = [ca, -sa, 0, -se * sa, -se * ca, ce, ce * sa, ce * ca, se];
    const M = mul3(V, R);
    this.R = R;
    this.V = V;
    this.M = M;
    // stereographic scale: W/2 px at half the horizontal FOV
    this.scale = this.W / 2 / (2 * Math.tan((this.cam.fov * D2R) / 4));
  }

  // Project a J2000 unit vector → {x, y, z (camera forward), u (altitude sine)}
  project(v) {
    const M = this.M;
    const qx = M[0] * v[0] + M[1] * v[1] + M[2] * v[2];
    const qy = M[3] * v[0] + M[4] * v[1] + M[5] * v[2];
    const qz = M[6] * v[0] + M[7] * v[1] + M[8] * v[2];
    const k = 2 / (1 + Math.max(qz, -0.999));
    const R = this.R;
    return { x: this.W / 2 + qx * k * this.scale, y: this.H / 2 - qy * k * this.scale, z: qz, u: R[6] * v[0] + R[7] * v[1] + R[8] * v[2] };
  }

  // Horizontal (alt/az degrees) → screen
  projectHorizontal(altDeg, azDeg) {
    const a = altDeg * D2R, z = azDeg * D2R;
    const h = [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
    const V = this.V;
    const qx = V[0] * h[0] + V[1] * h[1] + V[2] * h[2];
    const qy = V[3] * h[0] + V[4] * h[1] + V[5] * h[2];
    const qz = V[6] * h[0] + V[7] * h[1] + V[8] * h[2];
    const k = 2 / (1 + Math.max(qz, -0.999));
    return { x: this.W / 2 + qx * k * this.scale, y: this.H / 2 - qy * k * this.scale, z: qz };
  }

  // J2000 unit vector → {alt, az} degrees
  horizontal(v) {
    const R = this.R;
    const e = R[0] * v[0] + R[1] * v[1] + R[2] * v[2];
    const n = R[3] * v[0] + R[4] * v[1] + R[5] * v[2];
    const u = R[6] * v[0] + R[7] * v[1] + R[8] * v[2];
    return { alt: Math.asin(clamp(u, -1, 1)) * R2D, az: wrap360(Math.atan2(e, n) * R2D) };
  }

  // Screen → J2000 unit vector (inverse stereographic)
  unproject(x, y) {
    const px = (x - this.W / 2) / this.scale, py = -(y - this.H / 2) / this.scale;
    const r2 = px * px + py * py;
    const q = [(4 * px) / (4 + r2), (4 * py) / (4 + r2), (4 - r2) / (4 + r2)];
    const V = this.V, R = this.R;
    const h = [V[0] * q[0] + V[3] * q[1] + V[6] * q[2], V[1] * q[0] + V[4] * q[1] + V[7] * q[2], V[2] * q[0] + V[5] * q[1] + V[8] * q[2]];
    return [R[0] * h[0] + R[3] * h[1] + R[6] * h[2], R[1] * h[0] + R[4] * h[1] + R[7] * h[2], R[2] * h[0] + R[5] * h[1] + R[8] * h[2]];
  }

  // ---------- solar system bodies ----------
  updateBodies() {
    const now = performance.now();
    if (now - this.lastBodies < 1000 && !this.timeDirty) return;
    this.lastBodies = now;
    this.timeDirty = false;
    const date = this.date;
    const obs = new Astronomy.Observer(this.lat, this.lon, 0);
    const list = ['Sun', 'Moon', ...PLANETS];
    this.bodies = list.map((name) => {
      const eq = Astronomy.Equator(name, date, obs, false, true);
      const v = eqVec(eq.ra * 15, eq.dec);
      let mag = null, phase = null;
      try {
        const ill = Astronomy.Illumination(name, date);
        mag = ill.mag;
        phase = ill.phase_fraction;
      } catch {}
      return { kind: 'body', name, v, dist: eq.dist, mag, phase, info: PLANET_INFO[name] };
    });
    this.sun = this.bodies[0];
    this.moon = this.bodies[1];
  }

  // ---------- loop ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.frame(dt, t / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
    const ext = this.gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }

  updateCamera(dt) {
    const c = this.cam;
    if (!this.dragging) {
      if (Math.abs(this.vel.az) + Math.abs(this.vel.alt) > 0.01) {
        c.az = wrap360(c.az + this.vel.az * dt);
        c.alt = clamp(c.alt + this.vel.alt * dt, -12, 90);
        const f = Math.exp(-dt * 4.2);
        this.vel.az *= f;
        this.vel.alt *= f;
      }
      if (this.lock && this.heading != null) {
        c.az = wrap360(c.az + angDiff(c.az, this.heading) * Math.min(1, dt * 2.5));
      }
      if (this.target) {
        const k = Math.min(1, dt * 3.2);
        const t = this.target;
        c.az = wrap360(c.az + angDiff(c.az, t.az) * k);
        c.alt += (t.alt - c.alt) * k;
        if (t.fov) c.fov += (t.fov - c.fov) * k;
        if (Math.abs(angDiff(c.az, t.az)) < 0.05 && Math.abs(t.alt - c.alt) < 0.05 && (!t.fov || Math.abs(t.fov - c.fov) < 0.1)) this.target = null;
      }
    }
    if (this.zoomTarget != null) {
      c.fov += (this.zoomTarget - c.fov) * Math.min(1, dt * 10);
      if (Math.abs(this.zoomTarget - c.fov) < 0.05) this.zoomTarget = null;
    }
    c.fov = clamp(c.fov, 18, 160);
  }

  frame(dt, time) {
    if (!this.ready || !this.W) return;
    this.updateCamera(dt);
    this.computeMatrices();
    this.updateBodies();
    this.time = time;
    this.drawGL(time);
    this.draw2D(time);
    this.onCamera?.(this.cam);
  }

  drawGL(time) {
    const gl = this.gl;
    if (!gl) return;
    const sunH = this.sun ? this.enu(this.sun.v) : [0, 0, -1];
    const moonH = this.moon ? this.enu(this.moon.v) : [0, 0, -1];
    const day = smooth(-0.2, 0.08, sunH[2]);
    const V = this.V, R = this.R;

    // Sky dome
    const s = this.skyProg;
    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(s.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mwTex);
    gl.uniform1i(s.u.uMWTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const aPos = gl.getAttribLocation(s.p, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(s.u.uInv, this.W / 2 / this.scale, this.H / 2 / this.scale);
    gl.uniformMatrix3fv(s.u.uVt, false, V); // column-major upload of row-major V = transpose
    gl.uniformMatrix3fv(s.u.uRt, false, R);
    gl.uniformMatrix3fv(s.u.uGal, false, transpose3(GAL));
    gl.uniform3fv(s.u.uSun, sunH);
    gl.uniform3fv(s.u.uMoon, moonH);
    gl.uniform1f(s.u.uMoonLit, this.moon?.phase ?? 0);
    gl.uniform1f(s.u.uMW, this.layers.milkyway ? 1 : 0);
    gl.uniform1f(s.u.uNight, this.layers.night ? 1 : 0);
    gl.uniform1f(s.u.uTime, time % 100);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(aPos);

    // Stars
    if (!this.starCount) return;
    const p = this.starProg;
    gl.useProgram(p.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const bind = (buf, name, size) => {
      const loc = gl.getAttribLocation(p.p, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return loc;
    };
    const l1 = bind(this.bufPos, 'aPos', 3), l2 = bind(this.bufData, 'aData', 4), l3 = bind(this.bufPhase, 'aPhase', 1), l4 = bind(this.bufCorner, 'aCorner', 2);
    gl.uniform2f(p.u.uPixel, 2 / this.glCanvas.width, 2 / this.glCanvas.height);
    gl.uniformMatrix3fv(p.u.uM, false, transpose3(this.M));
    gl.uniform3f(p.u.uUp, R[6], R[7], R[8]);
    gl.uniform2f(p.u.uScale, this.scale / (this.W / 2), this.scale / (this.H / 2));
    const fov = this.cam.fov;
    gl.uniform1f(p.u.uLim, clamp(5.2 + (90 - fov) / 35, 4.3, 6.6));
    gl.uniform1f(p.u.uSizeK, clamp(Math.pow(90 / fov, 0.4), 0.75, 1.7));
    gl.uniform1f(p.u.uTime, time % 1000);
    gl.uniform1f(p.u.uDay, day);
    gl.uniform1f(p.u.uPx, this.dpr);
    gl.uniform1f(p.u.uNight, this.layers.night ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.starVerts);
    for (const l of [l1, l2, l3, l4]) gl.disableVertexAttribArray(l);
  }

  enu(v) {
    const R = this.R;
    return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  }

  // ---------- 2D overlay ----------
  draw2D(time) {
    const g = this.ctx;
    const { W, H } = this;
    const night = this.layers.night;
    const tint = (r, gg, b, a) => (night ? `rgba(${Math.round((r * 0.35 + gg * 0.55 + b * 0.1) * 1.2)},0,0,${a})` : `rgba(${r},${gg},${b},${a})`);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const fov = this.cam.fov;
    const onScreen = (p, m = 40) => p.z > -0.2 && p.x > -m && p.y > -m && p.x < W + m && p.y < H + m;
    const sel = this.selected;

    // Grid
    if (this.layers.grid) this.drawGrid(g, tint);

    // Constellation lines
    if (this.layers.lines) {
      g.lineWidth = 1;
      g.strokeStyle = tint(110, 160, 255, 0.17);
      g.beginPath();
      for (const c of this.constellations) {
        if (sel?.kind === 'constellation' && sel.id === c.id) continue;
        this.pathSegs(g, c.segs);
      }
      g.stroke();
    }
    if (sel?.kind === 'constellation') {
      const c = this.constellations.find((x) => x.id === sel.id);
      g.save();
      g.lineWidth = 2.2;
      g.strokeStyle = tint(124, 247, 212, 0.9);
      g.shadowColor = tint(124, 247, 212, 0.8);
      g.shadowBlur = 10;
      g.beginPath();
      this.pathSegs(g, c.segs);
      g.stroke();
      g.restore();
    }

    // Asterisms
    if (this.layers.asterisms) {
      for (const a of this.asterisms) {
        const hot = sel?.kind === 'asterism' && sel.id === a.id;
        g.save();
        g.lineWidth = hot ? 2.6 : 1.6;
        g.strokeStyle = tint(255, 214, 107, hot ? 0.95 : 0.5);
        if (hot) { g.shadowColor = tint(255, 214, 107, 0.9); g.shadowBlur = 12; }
        g.beginPath();
        this.pathSegs(g, a.segs);
        g.stroke();
        g.restore();
        const p = this.project(a.center);
        if (onScreen(p) && p.u > 0 && fov < 140) {
          g.font = `600 ${hot ? 16 : 13}px -apple-system, "Segoe UI", sans-serif`;
          g.fillStyle = tint(255, 214, 107, hot ? 1 : 0.75);
          g.textAlign = 'center';
          g.fillText(a.name, p.x, p.y + 4);
        }
      }
      // Pointer stars → Polaris guide when the Big Dipper is selected
      if (sel?.id === 'big-dipper') {
        const merak = this.starById.get(53910), dubhe = this.starById.get(54061), polaris = this.starById.get(11767);
        if (merak && dubhe && polaris) {
          const a = this.project(merak.v), b = this.project(polaris.v);
          if (a.z > -0.2 && b.z > -0.2) {
            g.save();
            g.setLineDash([6, 8]);
            g.lineDashOffset = -time * 30;
            g.strokeStyle = tint(255, 214, 107, 0.8);
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
            g.restore();
            g.font = '600 14px -apple-system, "Segoe UI", sans-serif';
            g.fillStyle = tint(255, 214, 107, 1);
            g.fillText('→ North Star', b.x + 14, b.y - 10);
          }
        }
      }
    }

    // Constellation names
    if (this.layers.labels && fov < 150) {
      g.textAlign = 'center';
      for (const c of this.constellations) {
        const p = this.project(c.label);
        if (!onScreen(p) || p.u < 0.02) continue;
        const a = clamp((150 - fov) / 60, 0, 1) * (c.rank === 1 ? 0.75 : c.rank === 2 ? 0.55 : 0.4) * (fov > 110 && c.rank > 1 ? 0.5 : 1);
        if (a < 0.08) continue;
        g.font = `500 ${c.rank === 1 ? 14 : 12}px -apple-system, "Segoe UI", sans-serif`;
        g.fillStyle = tint(150, 185, 235, a);
        g.fillText(c.name.toUpperCase().split('').join(' '), p.x, p.y);
      }
    }

    // Deep-sky objects
    for (const d of this.dsos) {
      const p = this.project(d.v);
      if (!onScreen(p) || p.u < 0) continue;
      g.strokeStyle = tint(195, 139, 255, 0.7);
      g.lineWidth = 1.2;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(p.x, p.y, 7, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      if (fov < 120 && this.layers.labels) {
        g.font = '500 12px -apple-system, "Segoe UI", sans-serif';
        g.fillStyle = tint(205, 170, 255, 0.85);
        g.textAlign = 'left';
        g.fillText(d.name, p.x + 11, p.y + 4);
      }
    }

    // Star names
    if (this.layers.labels) {
      const limit = fov < 50 ? 3.5 : fov < 80 ? 2.2 : 1.5;
      g.textAlign = 'left';
      g.font = '500 13px -apple-system, "Segoe UI", sans-serif';
      for (const s of this.named) {
        if (!s.name || s.mag > limit) continue;
        const p = this.project(s.v);
        if (!onScreen(p) || p.u < 0.01) continue;
        g.fillStyle = tint(225, 235, 255, 0.8);
        g.fillText(s.name, p.x + 9, p.y - 7);
      }
    }

    // Planets, Sun, Moon
    if (this.layers.planets) {
      for (const b of this.bodies) {
        const p = this.project(b.v);
        if (!onScreen(p, 80)) continue;
        const below = p.u < 0;
        g.globalAlpha = below ? 0.25 : 1;
        if (b.name === 'Moon') this.drawMoon(g, p, tint);
        else if (b.name === 'Sun') this.drawSun(g, p, tint);
        else this.drawPlanet(g, b, p, tint);
        g.globalAlpha = 1;
      }
    }

    // Horizon compass + car direction
    this.drawHorizon(g, tint);

    // Selection reticle
    if (sel) {
      const v = sel.v || sel.center || sel.label;
      if (v) {
        const p = this.project(v);
        if (p.z > -0.2) {
          const r = 22 + Math.sin(time * 3) * 2;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(time * 0.6);
          g.strokeStyle = tint(124, 247, 212, 0.95);
          g.lineWidth = 2;
          for (let i = 0; i < 4; i++) {
            g.beginPath();
            g.arc(0, 0, r, i * (Math.PI / 2) + 0.25, i * (Math.PI / 2) + Math.PI / 2 - 0.25);
            g.stroke();
          }
          g.restore();
        } else {
          this.drawOffscreenArrow(g, p, tint);
        }
      }
    }
  }

  pathSegs(g, segs) {
    const { W, H } = this;
    for (let i = 0; i < segs.length; i += 2) {
      const a = this.project(segs[i]), b = this.project(segs[i + 1]);
      if (a.z < -0.15 || b.z < -0.15) continue;
      if (a.u < -0.03 && b.u < -0.03) continue;
      if ((a.x < 0 && b.x < 0) || (a.x > W && b.x > W) || (a.y < 0 && b.y < 0) || (a.y > H && b.y > H)) continue;
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
  }

  drawPlanet(g, b, p, tint) {
    const col = b.info.color;
    const r = clamp(5.5 - (b.mag ?? 2) * 0.9, 2.5, 8);
    const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
    grad.addColorStop(0, this.layers.night ? 'rgba(255,40,40,0.7)' : hexA(col, 0.7));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = this.layers.night ? '#ff5050' : col;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
    if (b.name === 'Saturn') {
      g.strokeStyle = this.layers.night ? 'rgba(255,60,60,.8)' : 'rgba(240,216,144,.8)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(p.x, p.y, r * 2.2, r * 0.8, -0.4, 0, Math.PI * 2);
      g.stroke();
    }
    if (this.layers.labels) {
      g.font = '700 14px -apple-system, "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillStyle = this.layers.night ? '#ff6a6a' : col;
      g.fillText(b.name, p.x + r + 7, p.y + 5);
    }
  }

  drawSun(g, p, tint) {
    const r = Math.max(10, 0.53 * (this.W / this.cam.fov) * 0.5);
    const grad = g.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 5);
    grad.addColorStop(0, tint(255, 240, 200, 0.9));
    grad.addColorStop(1, tint(255, 200, 120, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(p.x, p.y, r * 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = tint(255, 246, 220, 1);
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
    if (this.layers.labels) {
      g.font = '700 14px -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = tint(255, 214, 107, 1);
      g.textAlign = 'left';
      g.fillText('Sun', p.x + r + 8, p.y + 5);
    }
  }

  drawMoon(g, p, tint) {
    const m = this.moon;
    const r = Math.max(15, 0.52 * (this.W / this.cam.fov) * 0.5 * 2.2);
    const f = m.phase ?? 0.5;
    // Orient the lit side toward the Sun on screen
    const sp = this.project(this.sun.v);
    const ang = Math.atan2(sp.y - p.y, sp.x - p.x);
    g.save();
    g.translate(p.x, p.y);
    const halo = g.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 3.2);
    halo.addColorStop(0, tint(210, 220, 255, 0.25 * f + 0.05));
    halo.addColorStop(1, tint(210, 220, 255, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 0, r * 3.2, 0, Math.PI * 2);
    g.fill();
    g.rotate(ang);
    // dark disk
    g.fillStyle = tint(40, 46, 60, 0.9);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    // lit half toward the sun (+x)
    const lit = g.createRadialGradient(r * 0.3, -r * 0.2, r * 0.1, 0, 0, r);
    lit.addColorStop(0, tint(252, 252, 246, 1));
    lit.addColorStop(1, tint(200, 205, 215, 1));
    g.fillStyle = lit;
    g.beginPath();
    g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    g.fill();
    // terminator ellipse: bright for gibbous, dark for crescent
    const rx = r * Math.abs(2 * f - 1);
    g.fillStyle = f > 0.5 ? lit : tint(40, 46, 60, 1);
    g.beginPath();
    g.ellipse(0, 0, Math.max(rx, 0.01), r, 0, -Math.PI / 2, Math.PI / 2, f <= 0.5);
    g.fill();
    // a few maria for texture
    g.fillStyle = tint(120, 125, 140, 0.18 * Math.min(1, f * 2));
    for (const [x, y, s] of [[-0.25, -0.3, 0.22], [0.2, -0.1, 0.18], [0.05, 0.3, 0.15], [-0.35, 0.15, 0.12]]) {
      g.beginPath();
      g.arc(x * r, y * r, s * r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    if (this.layers.labels) {
      g.font = '700 14px -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = tint(230, 236, 250, 0.95);
      g.textAlign = 'left';
      g.fillText(`Moon · ${Math.round(f * 100)}%`, p.x + r + 10, p.y + 5);
    }
  }

  drawHorizon(g, tint) {
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    g.textAlign = 'center';
    for (let az = 0; az < 360; az += 15) {
      const p = this.projectHorizontal(0, az);
      if (p.z < 0 || p.x < -20 || p.x > this.W + 20) continue;
      const main = labels[az];
      g.strokeStyle = tint(160, 200, 255, main ? 0.7 : 0.3);
      g.lineWidth = main ? 2 : 1;
      g.beginPath();
      g.moveTo(p.x, p.y - (main ? 10 : 5));
      g.lineTo(p.x, p.y + (main ? 10 : 5));
      g.stroke();
      if (main) {
        g.font = `800 ${main.length === 1 ? 20 : 15}px -apple-system, "Segoe UI", sans-serif`;
        g.fillStyle = main === 'N' ? tint(255, 90, 106, 0.95) : tint(200, 220, 245, 0.85);
        g.fillText(main, p.x, p.y + 32);
      }
    }
    // Car heading marker
    if (this.heading != null) {
      const p = this.projectHorizontal(0, this.heading);
      if (p.z > 0 && p.x > -30 && p.x < this.W + 30) {
        g.save();
        g.translate(p.x, p.y);
        g.fillStyle = tint(63, 182, 255, 0.95);
        g.shadowColor = tint(63, 182, 255, 0.9);
        g.shadowBlur = 14;
        g.beginPath();
        g.moveTo(0, -18);
        g.lineTo(11, 4);
        g.lineTo(0, -2);
        g.lineTo(-11, 4);
        g.closePath();
        g.fill();
        g.shadowBlur = 0;
        g.font = '700 13px -apple-system, "Segoe UI", sans-serif';
        g.fillText('AHEAD', 0, 52);
        g.restore();
      }
    }
    // Zenith marker
    const z = this.projectHorizontal(90, 0);
    if (z.z > 0.2 && z.y > 0 && z.y < this.H) {
      g.strokeStyle = tint(160, 200, 255, 0.4);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(z.x - 8, z.y); g.lineTo(z.x + 8, z.y); g.moveTo(z.x, z.y - 8); g.lineTo(z.x, z.y + 8);
      g.stroke();
      g.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = tint(160, 200, 255, 0.6);
      g.fillText('STRAIGHT UP', z.x, z.y + 22);
    }
  }

  drawGrid(g, tint) {
    g.strokeStyle = tint(120, 160, 220, 0.12);
    g.lineWidth = 1;
    for (const alt of [15, 30, 45, 60, 75]) {
      g.beginPath();
      let started = false;
      for (let az = 0; az <= 360; az += 3) {
        const p = this.projectHorizontal(alt, az);
        if (p.z < -0.1) { started = false; continue; }
        started ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        started = true;
      }
      g.stroke();
    }
    for (let az = 0; az < 360; az += 30) {
      g.beginPath();
      let started = false;
      for (let alt = 0; alt <= 90; alt += 3) {
        const p = this.projectHorizontal(alt, az);
        if (p.z < -0.1) { started = false; continue; }
        started ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        started = true;
      }
      g.stroke();
    }
  }

  drawOffscreenArrow(g, p, tint) {
    const cx = this.W / 2, cy = this.H / 2;
    const ang = Math.atan2(p.y - cy, p.x - cx);
    const r = Math.min(this.W, this.H) * 0.42;
    g.save();
    g.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    g.rotate(ang);
    g.fillStyle = tint(124, 247, 212, 0.9);
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(-8, 10);
    g.lineTo(-8, -10);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ---------- picking ----------
  pick(x, y) {
    let best = null;
    const consider = (obj, v, bonus = 0, radius = 34) => {
      const p = this.project(v);
      if (p.z < -0.1) return;
      const d = Math.hypot(p.x - x, p.y - y) - bonus;
      if (d < radius && (!best || d < best.d)) best = { obj, d };
    };
    for (const b of this.bodies) consider(b, b.v, b.name === 'Moon' ? 20 : 8, 44);
    for (const s of this.named) consider(s, s.v, (3 - s.mag) * 3);
    for (const d of this.dsos) consider(d, d.v, 2);
    if (this.layers.asterisms) for (const a of this.asterisms) consider(a, a.center, -6, 40);
    if (best) return best.obj;

    // Otherwise the constellation whose lines pass closest to the tap
    let near = null;
    for (const c of this.constellations) {
      for (let i = 0; i < c.segs.length; i += 2) {
        const a = this.project(c.segs[i]), b = this.project(c.segs[i + 1]);
        if (a.z < -0.1 || b.z < -0.1) continue;
        const d = segDist(x, y, a.x, a.y, b.x, b.y);
        if (d < 26 && (!near || d < near.d)) near = { obj: c, d };
      }
      const lp = this.project(c.label);
      if (lp.z > 0) {
        const d = Math.hypot(lp.x - x, lp.y - y);
        if (d < 40 && (!near || d < near.d)) near = { obj: c, d };
      }
    }
    return near?.obj || null;
  }

  select(obj) {
    this.selected = obj;
    this.onSelect?.(obj);
  }

  // Smoothly point the camera at an object
  flyTo(obj, fov) {
    const v = obj.v || obj.center || obj.label;
    if (!v) return;
    this.computeMatrices();
    const h = this.horizontal(v);
    this.lock = false;
    this.vel = { az: 0, alt: 0 };
    this.target = { az: h.az, alt: clamp(h.alt, -8, 88), fov: fov ?? (obj.kind === 'constellation' ? clamp((obj.size || 20) * 2.6, 45, 110) : obj.kind === 'asterism' ? 70 : Math.min(this.cam.fov, 75)) };
  }

  recenter() {
    this.lock = true;
    this.target = { az: this.heading ?? this.cam.az, alt: 28, fov: 95 };
  }

  lookUp() {
    this.lock = false;
    this.target = { az: this.cam.az, alt: 88, fov: 150 };
  }

  // ---------- input ----------
  bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.target = null;
      this.zoomTarget = null;
      this.vel = { az: 0, alt: 0 };
      if (this.pointers.size === 1) {
        this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
        this.dragging = true;
        this.lastMove = { x: e.clientX, y: e.clientY, t: performance.now() };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.cam.fov };
        this.down.moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.fov = clamp(this.pinch.fov * (this.pinch.d / Math.max(d, 1)), 18, 160);
        return;
      }
      if (this.pointers.size !== 1 || !this.down) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) {
        if (!this.down.moved) this.lock = false;
        this.down.moved = true;
      }
      if (!this.down.moved) return;
      const degPerPx = (this.cam.fov / this.W) * 1.05;
      this.cam.az = wrap360(this.cam.az - dx * degPerPx);
      this.cam.alt = clamp(this.cam.alt + dy * degPerPx, -12, 90);
      const now = performance.now();
      const dt = Math.max(1, now - this.lastMove.t) / 1000;
      this.vel = { az: (-dx * degPerPx) / dt * 0.6 + this.vel.az * 0.4, alt: (dy * degPerPx) / dt * 0.6 + this.vel.alt * 0.4 };
      this.lastMove = { x: e.clientX, y: e.clientY, t: now };
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) {
        this.dragging = false;
        if (performance.now() - (this.lastMove?.t || 0) > 80) this.vel = { az: 0, alt: 0 };
        const d = this.down;
        if (d && !d.moved && performance.now() - d.t < 400) {
          const r = this.canvas.getBoundingClientRect();
          const x = e.clientX - r.left, y = e.clientY - r.top;
          const now = performance.now();
          if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30) {
            // double tap: zoom toward the point
            const v = this.unproject(x, y);
            const h = this.horizontal(v);
            this.lock = false;
            this.target = { az: h.az, alt: clamp(h.alt, -8, 88), fov: Math.max(18, this.cam.fov * 0.55) };
            this.lastTap = null;
          } else {
            this.lastTap = { x, y, t: now };
            this.select(this.pick(x, y));
          }
        }
        this.down = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomTarget = clamp((this.zoomTarget ?? this.cam.fov) * Math.exp(e.deltaY * 0.0012), 18, 160);
    }, { passive: false });
  }
}

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function transpose3(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
