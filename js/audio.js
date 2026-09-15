// Sound: one shared AudioContext (unlocked by the first tap), a master volume
// that can boost past 100% (a compressor keeps it from clipping), a soft echo
// bus for chimes, synthesized sound effects, and playback of generated speech.
import { settings, bus } from './util.js';

let ctx = null;
let master = null;
let fxBus = null;

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master = ctx.createGain();
  master.gain.value = settings.get().volume ?? 1;
  master.connect(comp).connect(ctx.destination);

  // Chimes: dry signal plus a gentle filtered echo for a soft, airy tail.
  fxBus = ctx.createGain();
  fxBus.connect(master);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.19;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
  fxBus.connect(delay);
  delay.connect(tone).connect(feedback).connect(delay);
  tone.connect(wet).connect(master);
}

function note(freq, start, dur, { type = 'sine', gain = 0.12, attack = 0.006, glide = 0 } = {}) {
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(fxBus);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// A soft glass-bell ding: a pure tone with quiet inharmonic partials and a long decay.
function bell(freq, start = 0, gain = 0.1, dur = 1.8) {
  note(freq, start, dur, { gain });
  note(freq * 2.01, start, dur * 0.6, { gain: gain * 0.28 });
  note(freq * 3.0, start, dur * 0.35, { gain: gain * 0.1 });
  note(freq * 4.2, start, dur * 0.2, { gain: gain * 0.05 });
}

const SOUNDS = {
  start: () => { note(220, 0, 1.4, { gain: 0.09, attack: 0.5, glide: 2 }); note(330, 0.15, 1.4, { gain: 0.06, attack: 0.5, glide: 2 }); },
  ding: () => { bell(1046.5, 0, 0.09); bell(1568, 0.12, 0.06, 1.6); },
  collect: () => { bell(1046.5, 0, 0.09); bell(1568, 0.12, 0.06, 1.6); },
  rare: () => { bell(1046.5, 0, 0.09); bell(1318.5, 0.1, 0.07); bell(1568, 0.2, 0.07); bell(2093, 0.3, 0.05, 2.2); },
  legendary: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => bell(f, i * 0.09, 0.075, 2.4)),
  quest: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, i * 0.11, 0.08, 1.6)),
  alert: () => { note(740, 0, 0.25, { gain: 0.16, type: 'triangle' }); note(554, 0.28, 0.35, { gain: 0.16, type: 'triangle' }); },
  spill: () => note(200, 0, 0.25, { gain: 0.08, glide: 0.5 }),
  // Gentle two-tone "wee-woo" for police: soft triangle tones, not a siren
  police: () => [0, 0.32, 0.64].forEach((t) => { note(932, t, 0.18, { gain: 0.14, type: 'triangle' }); note(698, t + 0.16, 0.18, { gain: 0.14, type: 'triangle' }); }),
  region: () => { bell(784, 0, 0.08); bell(1175, 0.18, 0.07, 2); },
  select: () => bell(1760, 0, 0.045, 0.9),
  test: () => [523.25, 659.25, 783.99].forEach((f, i) => bell(f, i * 0.16, 0.12, 1.4)),
};

export const audio = {
  get state() {
    return ctx ? ctx.state : 'not started';
  },

  // Call from a tap. Browsers (and the car) only allow audio after a gesture.
  unlock() {
    try {
      if (!ctx) build();
      ctx.resume();
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {}
  },

  setVolume(v) {
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
  },

  sfx(kind, force = false) {
    if (!ctx || (!force && !settings.get().sfx)) return;
    if (ctx.state === 'suspended') ctx.resume();
    try {
      SOUNDS[kind]?.();
    } catch {}
  },

  // Play an audio Blob (e.g. generated speech). Resolves when finished.
  async playBlob(blob) {
    if (!ctx) this.unlock();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.onended = resolve;
      this.current = src;
      src.start();
    });
  },

  stopPlayback() {
    try {
      this.current?.stop();
    } catch {}
    this.current = null;
  },
};

bus.on('settings', (s) => audio.setVolume(s.volume ?? 1));
