// Speech. Two engines:
//  - "Browser": the built-in speechSynthesis voices. Many Linux Chromium builds
//    (including car browsers) ship with no voices at all, so this can be silent.
//  - "Natural": a Piper neural voice running locally in WebAssembly. The voice
//    model (~63 MB) downloads once and is cached; audio plays through the
//    shared AudioContext like any other web audio.
// "Auto" uses browser voices if any exist, otherwise the natural voice.
import { settings, bus } from './util.js';
import { audio } from './audio.js';

const VOICE_ID = 'en_US-hfc_female-medium';
// jsDelivr's +esm build resolves the bare "onnxruntime-web" import (pinned 1.18.0).
const VITS = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
const synth = typeof window !== 'undefined' ? window.speechSynthesis || null : null;

let voice = null;
function nativeVoices() {
  try {
    return synth ? synth.getVoices() : [];
  } catch {
    return [];
  }
}
function pickVoice() {
  const voices = nativeVoices();
  const en = voices.filter((v) => /^en(-|_)?/i.test(v.lang));
  voice =
    en.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ||
    en.find((v) => /google us english|samantha|aria|jenny|guy/i.test(v.name)) ||
    en.find((v) => /en-US/i.test(v.lang)) || en[0] || voices[0] || null;
}
if (synth) {
  pickVoice();
  synth.onvoiceschanged = pickVoice;
}
const waitVoices = (ms) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => (nativeVoices().length || Date.now() - t0 > ms ? resolve() : setTimeout(check, 150));
    check();
  });

// ---------------- Neural engine ----------------
class Neural {
  constructor() {
    this.worker = null;
    this.mode = null; // 'worker' | 'main'
    this.pending = new Map();
    this.seq = 0;
    this.ready = false;
    this.downloading = false;
    this.progress = 0;
    this.error = null;
    this.mod = null;
    this.preparing = null;
  }

  makeWorker() {
    const w = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, progress, ok, error, ...rest } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      if (ok === undefined) return p.onProgress?.(progress);
      this.pending.delete(id);
      clearTimeout(p.timer);
      ok ? p.resolve(rest) : p.reject(new Error(error));
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'worker failed'));
      this.pending.clear();
    };
    return w;
  }

  viaWorker(type, payload, onProgress, timeout) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const entry = { resolve, reject, onProgress };
      if (timeout) entry.timer = setTimeout(() => { this.pending.delete(id); reject(new Error('worker timeout')); }, timeout);
      this.pending.set(id, entry);
      this.worker.postMessage({ id, type, voiceId: VOICE_ID, ...payload });
    });
  }

  async call(type, payload = {}, onProgress) {
    if (this.mode !== 'main') {
      try {
        this.worker ||= this.makeWorker();
        const r = await this.viaWorker(type, payload, onProgress, type === 'download' ? 0 : 60000);
        this.mode = 'worker';
        return r;
      } catch (e) {
        if (this.mode === 'worker') throw e;
        // Worker can't run the engine in this browser: fall back to the main thread.
        this.mode = 'main';
        this.worker?.terminate();
        this.worker = null;
      }
    }
    this.mod ||= await import(VITS);
    if (type === 'stored') return { stored: await this.mod.stored() };
    if (type === 'download') {
      await this.mod.download(VOICE_ID, (p) => onProgress?.(p.total ? p.loaded / p.total : 0));
      return {};
    }
    return { wav: await this.mod.predict({ text: payload.text, voiceId: VOICE_ID }) };
  }

  prepare() {
    if (this.ready) return Promise.resolve(true);
    this.preparing ||= (async () => {
      try {
        const { stored = [] } = await this.call('stored');
        if (!stored.includes(VOICE_ID)) {
          this.downloading = true;
          bus.emit('voice-status');
          await this.call('download', {}, (p) => {
            this.progress = p;
            bus.emit('voice-progress', p);
          });
        }
        this.ready = true;
        this.error = null;
        return true;
      } catch (e) {
        this.error = e.message;
        return false;
      } finally {
        this.downloading = false;
        this.preparing = null;
        bus.emit('voice-status');
      }
    })();
    return this.preparing;
  }

  async synth(text) {
    return (await this.call('predict', { text })).wav;
  }
}
const neural = new Neural();

// Merge sentences into ~220 character chunks: short enough to start speaking fast.
function chunkText(text) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 220 && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------- Controller ----------------
let queue = [];
let speaking = false;
let gen = 0;

export const speech = {
  engine: null, // 'native' | 'neural' | 'none'
  neural,
  available: true,

  // Call from a tap: unlocks audio and decides which engine to use.
  unlock() {
    audio.unlock();
    try {
      if (synth) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        synth.speak(u);
      }
    } catch {}
    this.init();
  },

  async init() {
    const pref = settings.get().voiceEngine;
    if (pref === 'browser') this.engine = synth ? 'native' : 'none';
    else if (pref === 'natural') this.engine = 'neural';
    else {
      await waitVoices(1500);
      this.engine = nativeVoices().length ? 'native' : 'neural';
    }
    if (this.engine === 'neural') neural.prepare();
    bus.emit('voice-status');
  },

  status() {
    return {
      engine: this.engine,
      nativeVoices: nativeVoices().length,
      voiceName: voice?.name || null,
      neuralReady: neural.ready,
      downloading: neural.downloading,
      progress: neural.progress,
      error: neural.error,
      mode: neural.mode,
      audio: audio.state,
    };
  },

  say(text, { priority = false, kind = 'story' } = {}) {
    if (!text) return;
    const s = settings.get();
    if (kind === 'story' && !s.voice) return;
    if (kind === 'alert' && !s.alertVoice) return;
    if (!this.engine) this.init();
    if (priority) this.stop();
    queue.push(text);
    if (queue.length > 3) queue = queue.slice(-3);
    pump();
  },

  stop() {
    queue = [];
    gen++;
    try {
      synth?.cancel();
    } catch {}
    audio.stopPlayback();
    speaking = false;
  },

  test() {
    audio.sfx('test', true);
    setTimeout(() => this.say('Uncharted voice check. Every road you drive clears the fog.', { priority: true, kind: 'manual' }), 700);
  },
};

async function pump() {
  if (speaking || !queue.length) return;
  const text = queue.shift();
  const myGen = gen;
  speaking = true;
  try {
    if (speech.engine === 'neural') await speakNeural(text, myGen);
    else if (speech.engine === 'native') await speakNative(text);
  } catch (e) {
    console.warn('speech', e);
  }
  if (myGen !== gen) return;
  speaking = false;
  setTimeout(pump, 350);
}

function speakNative(text) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.volume = Math.min(1, settings.get().volume ?? 1);
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
    // Chromium sometimes never fires onend.
    setTimeout(resolve, Math.max(4000, text.length * 90));
  });
}

async function speakNeural(text, myGen) {
  if (!neural.ready) {
    // Don't make stories wait for a download; manual/alert speech waits.
    if (neural.downloading) return;
    if (!(await neural.prepare())) return;
  }
  const chunks = chunkText(text);
  let next = neural.synth(chunks[0]);
  for (let i = 0; i < chunks.length; i++) {
    const wav = await next;
    if (myGen !== gen) return;
    next = i + 1 < chunks.length ? neural.synth(chunks[i + 1]) : null;
    await audio.playBlob(wav);
    if (myGen !== gen) return;
  }
}
