// Fog of war: a grid of ~45 m cells. Every cell you drive through is
// revealed forever.
//
// Rendering: fog is painted into an offscreen canvas covering a 10 km square
// around the car in Web-Mercator space, then drawn by a small WebGL custom
// layer, so the GPU handles pan/zoom/pitch/rotation for free. The canvas is
// only re-uploaded when new cells are revealed or the car leaves the region.
// The rest of the world outside the region is drawn as solid fog.
/* global maplibregl */
import { bus, idb, distance } from './util.js';

const CELL = 0.0004; // degrees latitude (~44 m)
const CELL_M = CELL * 111320;
const BUCKET = 64; // cells per spatial bucket side
const REVEAL_M = 55; // reveal radius around the car
const SIZE = 1024; // canvas px (~10 m per texel; fog edges are soft anyway)
const REGION_M = 10000; // canvas covers REGION_M × REGION_M
const RECENTER_M = 3000; // recenter when the car is this far from center
const FOG_RGBA = [3, 5, 9, 0.62];

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform mat4 u_matrix;
varying vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;
// a_uv < 0 marks the solid surround; otherwise sample the premultiplied canvas.
const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec4 u_fog;
varying vec2 v_uv;
void main() {
  gl_FragColor = v_uv.x < -0.5 ? u_fog : texture2D(u_tex, v_uv);
}`;

export class Fog {
  constructor() {
    this.cells = new Set();
    this.buckets = new Map(); // "by:bx" -> [[lat, lon], ...]
    this.todayNew = 0;
    this.prevFix = null;
    this.dirty = false;
    this.map = null;
    this.region = null;
    this.pending = [];
    this.needsUpload = true;
    this.needsGeometry = true;
    this.sprite = makeSprite();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    // CPU-backed canvas: stamping cells never waits on the (busy) GPU; the
    // finished texture is uploaded to WebGL only when it changes.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.paintBase();
  }

  async load() {
    const arr = await idb.get('fogCells', []);
    for (const k of arr) this.addKey(k);
    setInterval(() => this.save(), 30000);
    if (this.region) this.fullRedraw();
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    return idb.set('fogCells', [...this.cells]);
  }

  get areaKm2() {
    return (this.cells.size * CELL_M * CELL_M) / 1e6;
  }

  keyFor(lat, lon) {
    const cy = Math.floor(lat / CELL);
    const lonCell = CELL / Math.cos(((cy + 0.5) * CELL * Math.PI) / 180);
    return `${cy}:${Math.floor(lon / lonCell)}`;
  }

  centerOf(key) {
    const [cy, cx] = key.split(':').map(Number);
    const lat = (cy + 0.5) * CELL;
    const lonCell = CELL / Math.cos((lat * Math.PI) / 180);
    return [lat, (cx + 0.5) * lonCell];
  }

  addKey(key) {
    if (this.cells.has(key)) return null;
    this.cells.add(key);
    const [cy, cx] = key.split(':').map(Number);
    const bk = `${Math.floor(cy / BUCKET)}:${Math.floor(cx / BUCKET)}`;
    let b = this.buckets.get(bk);
    if (!b) this.buckets.set(bk, (b = []));
    const c = this.centerOf(key);
    b.push(c);
    return c;
  }

  isVisited(lat, lon) {
    return this.cells.has(this.keyFor(lat, lon));
  }

  // Reveal along the path from the previous fix (GPS fixes can be 30+ m apart).
  reveal(fix) {
    if (fix.acc > 60) return 0;
    const pts = [[fix.lat, fix.lon]];
    const p = this.prevFix;
    if (p) {
      const d = distance(p.lat, p.lon, fix.lat, fix.lon);
      if (d < 400) {
        const n = Math.floor(d / 20);
        for (let i = 1; i <= n; i++) pts.push([p.lat + ((fix.lat - p.lat) * i) / (n + 1), p.lon + ((fix.lon - p.lon) * i) / (n + 1)]);
      }
    }
    this.prevFix = fix;
    this.ensureRegion(fix.lat, fix.lon);
    let added = 0;
    for (const [lat, lon] of pts) added += this.revealAround(lat, lon);
    if (added) {
      this.dirty = true;
      this.todayNew += added;
      this.flushPending();
      bus.emit('fog', { added, areaKm2: this.areaKm2, cells: this.cells.size });
    }
    return added;
  }

  revealAround(lat, lon) {
    let added = 0;
    const r = Math.ceil(REVEAL_M / CELL_M);
    const lonStep = CELL / Math.cos((lat * Math.PI) / 180);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const c = this.addKey(this.keyFor(lat + dy * CELL, lon + dx * lonStep));
        if (c) {
          this.pending.push(c);
          added++;
        }
      }
    }
    return added;
  }

  // ---------- region + canvas ----------

  ensureRegion(lat, lon, force = false) {
    const r = this.region;
    if (!force && r && distance(r.lat, r.lon, lat, lon) < RECENTER_M) return;
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat]);
    const half = (REGION_M / 2) * mc.meterInMercatorCoordinateUnits();
    const ll = (x, y) => new maplibregl.MercatorCoordinate(x, y).toLngLat();
    const nw = ll(mc.x - half, mc.y - half), se = ll(mc.x + half, mc.y + half);
    this.region = {
      lat, lon, x0: mc.x - half, y0: mc.y - half, span: half * 2,
      bbox: { s: se.lat, n: nw.lat, w: nw.lng, e: se.lng },
      pxPerM: SIZE / REGION_M,
    };
    this.needsGeometry = true;
    this.fullRedraw();
  }

  paintBase() {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = `rgba(${FOG_RGBA.join(',')})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  punch(lat, lon) {
    const r = this.region;
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat]);
    const x = ((mc.x - r.x0) / r.span) * SIZE;
    const y = ((mc.y - r.y0) / r.span) * SIZE;
    const rad = REVEAL_M * 1.35 * r.pxPerM;
    if (x < -rad || y < -rad || x > SIZE + rad || y > SIZE + rad) return false;
    // Pre-sized sprite: an unscaled drawImage is much cheaper than a scaled one
    if (!this.stamp || this.stampRad !== rad) {
      this.stampRad = rad;
      this.stamp = makeSprite(Math.ceil(rad * 2));
    }
    this.ctx.drawImage(this.stamp, Math.round(x - rad), Math.round(y - rad));
    return true;
  }

  fullRedraw() {
    if (!this.region) return 0;
    this.paintBase();
    this.pending = [];
    const b = this.region.bbox;
    const pad = CELL * 3;
    const lonCell = CELL / Math.cos((((b.s + b.n) / 2) * Math.PI) / 180);
    const byMin = Math.floor((b.s - pad) / CELL / BUCKET), byMax = Math.floor((b.n + pad) / CELL / BUCKET);
    const bxMin = Math.floor((b.w - pad) / lonCell / BUCKET) - 1, bxMax = Math.floor((b.e + pad) / lonCell / BUCKET) + 1;
    this.ctx.globalCompositeOperation = 'destination-out';
    let n = 0;
    for (let by = byMin; by <= byMax; by++) {
      for (let bx = bxMin; bx <= bxMax; bx++) {
        const arr = this.buckets.get(`${by}:${bx}`);
        if (!arr) continue;
        for (const [lat, lon] of arr) if (this.punch(lat, lon)) n++;
      }
    }
    this.upload();
    return n;
  }

  flushPending() {
    if (!this.region || !this.pending.length) return;
    this.ctx.globalCompositeOperation = 'destination-out';
    for (const [lat, lon] of this.pending) this.punch(lat, lon);
    this.pending = [];
    this.upload();
  }

  upload() {
    this.needsUpload = true;
    this.map?.triggerRepaint();
  }

  // ---------- WebGL custom layer ----------

  attach(map) {
    this.map = map;
    if (!this.region) {
      const c = map.getCenter();
      this.ensureRegion(c.lat, c.lng, true);
    }
    if (map.getLayer('fog')) return;
    const fog = this;
    map.addLayer({
      id: 'fog',
      type: 'custom',
      renderingMode: '2d',
      onAdd(_map, gl) {
        const sh = (type, src) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          return s;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        this.prog = prog;
        this.aPos = gl.getAttribLocation(prog, 'a_pos');
        this.aUv = gl.getAttribLocation(prog, 'a_uv');
        this.uMatrix = gl.getUniformLocation(prog, 'u_matrix');
        this.uTex = gl.getUniformLocation(prog, 'u_tex');
        this.uFog = gl.getUniformLocation(prog, 'u_fog');
        this.buf = gl.createBuffer();
        this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        fog.needsUpload = true;
        fog.needsGeometry = true;
      },
      onRemove(_map, gl) {
        gl.deleteBuffer(this.buf);
        gl.deleteTexture(this.tex);
        gl.deleteProgram(this.prog);
      },
      render(gl, matrix) {
        const r = fog.region;
        if (!r) return;
        if (fog.needsGeometry) {
          // Region quad (textured) + four solid-fog quads around it.
          const x0 = r.x0, y0 = r.y0, x1 = r.x0 + r.span, y1 = r.y0 + r.span;
          const N = -1; // uv marker for solid fog
          const quad = (ax, ay, bx, by, u0, v0, u1, v1) => [ax, ay, u0, v0, bx, ay, u1, v0, ax, by, u0, v1, ax, by, u0, v1, bx, ay, u1, v0, bx, by, u1, v1];
          const verts = [
            ...quad(x0, y0, x1, y1, 0, 0, 1, 1),
            ...quad(-1, -1, 2, y0, N, N, N, N),
            ...quad(-1, y1, 2, 2, N, N, N, N),
            ...quad(-1, y0, x0, y1, N, N, N, N),
            ...quad(x1, y0, 2, y1, N, N, N, N),
          ];
          gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
          fog.needsGeometry = false;
        }
        gl.useProgram(this.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        if (fog.needsUpload) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fog.canvas);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          fog.needsUpload = false;
        }
        gl.uniformMatrix4fv(this.uMatrix, false, matrix);
        gl.uniform1i(this.uTex, 0);
        const a = FOG_RGBA[3];
        gl.uniform4f(this.uFog, (FOG_RGBA[0] / 255) * a, (FOG_RGBA[1] / 255) * a, (FOG_RGBA[2] / 255) * a, a);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.enableVertexAttribArray(this.aPos);
        gl.enableVertexAttribArray(this.aUv);
        gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 30);
      },
    });
    this.fullRedraw();
  }
}

function makeSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
