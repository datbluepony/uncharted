// Text-to-speech through the car speakers using the browser's built-in voices.
import { settings } from './util.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voice = null;
let queue = [];
let speaking = false;

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  const en = voices.filter((v) => /^en(-|_)?/i.test(v.lang));
  voice =
    en.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ||
    en.find((v) => /google us english|samantha|aria|jenny|guy/i.test(v.name)) ||
    en.find((v) => /en-US/i.test(v.lang)) ||
    en[0] ||
    voices[0] ||
    null;
}
if (synth) {
  pickVoice();
  synth.onvoiceschanged = pickVoice;
}

export const speech = {
  available: !!synth,

  // Must be called from a user gesture once so the browser allows audio.
  unlock() {
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  },

  say(text, { priority = false, kind = 'story' } = {}) {
    if (!synth || !text) return;
    const s = settings.get();
    if (kind === 'story' && !s.voice) return;
    if (kind === 'alert' && !s.alertVoice) return;
    if (priority) {
      // Alerts jump the queue and interrupt narration.
      queue = [];
      synth.cancel();
      speaking = false;
    }
    queue.push(text);
    if (queue.length > 3) queue = queue.slice(-3);
    pump();
  },

  stop() {
    queue = [];
    synth?.cancel();
    speaking = false;
  },
};

function pump() {
  if (speaking || !queue.length) return;
  const text = queue.shift();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.pitch = 1;
  speaking = true;
  const done = () => {
    speaking = false;
    setTimeout(pump, 400);
  };
  u.onend = done;
  u.onerror = done;
  synth.speak(u);
  // Chromium sometimes never fires onend; guard with a timeout.
  setTimeout(() => speaking && done(), Math.max(4000, text.length * 90));
}
