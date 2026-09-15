// Neural text-to-speech worker (Piper voices via ONNX Runtime WebAssembly).
// Runs off the main thread so the map stays smooth while speech is generated.
// The voice model (~63 MB) downloads once and is cached in the browser.
let tts = null;

self.onmessage = async (e) => {
  const { id, type, text, voiceId } = e.data;
  try {
    // +esm resolves the bare "onnxruntime-web" import to the pinned 1.18.0 build.
    tts ||= await import('https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm');
    if (type === 'stored') {
      postMessage({ id, ok: true, stored: await tts.stored() });
    } else if (type === 'download') {
      await tts.download(voiceId, (p) => postMessage({ id, progress: p.total ? p.loaded / p.total : 0 }));
      postMessage({ id, ok: true });
    } else if (type === 'predict') {
      const wav = await tts.predict({ text, voiceId });
      postMessage({ id, ok: true, wav });
    }
  } catch (err) {
    postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
