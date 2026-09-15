// Sound: one shared AudioContext (unlocked by the first tap), synthesized
// sound effects, and playback of generated speech audio.
import { settings } from './util.js';

let ctx = null;

function tone(freq, start, dur, { type = 'sine', gain = 0.18, attack = 0.01, glide = 0 } = {}) {
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const SOUNDS = {
  start: () => { tone(220, 0, 1.2, { gain: 0.12, attack: 0.4, glide: 2 }); tone(330, 0.15, 1.2, { gain: 0.08, attack: 0.4, glide: 2 }); },
  collect: () => { tone(988, 0, 0.18, { gain: 0.14 }); tone(1480, 0.08, 0.3, { gain: 0.12 }); },
  rare: () => [660, 880, 1320, 1760].forEach((f, i) => tone(f, i * 0.07, 0.35, { gain: 0.12 })),
  legendary: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.08, 0.6, { gain: 0.11 })); tone(2093, 0.45, 0.9, { gain: 0.05, type: 'triangle' }); },
  quest: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.5, { gain: 0.13, type: 'triangle' })),
  alert: () => { tone(740, 0, 0.22, { gain: 0.2, type: 'triangle' }); tone(554, 0.26, 0.3, { gain: 0.2, type: 'triangle' }); },
  spill: () => tone(200, 0, 0.25, { gain: 0.12, glide: 0.5 }),
  region: () => { tone(392, 0, 0.5, { gain: 0.1, type: 'triangle' }); tone(587, 0.18, 0.7, { gain: 0.1, type: 'triangle' }); },
  test: () => [440, 554, 659].forEach((f, i) => tone(f, i * 0.15, 0.4, { gain: 0.18 })),
};

export const audio = {
  get state() {
    return ctx ? ctx.state : 'not started';
  },

  // Call from a tap. Browsers (and the car) only allow audio after a gesture.
  unlock() {
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume();
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {}
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
      src.connect(ctx.destination);
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
