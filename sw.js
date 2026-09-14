// App-shell cache. Network first (so updates arrive immediately), falling
// back to the cached copy when the car's connection drops. Map tiles and
// data APIs are left to the network.
const CACHE = 'uncharted-v2';
const SHELL = [
  './', 'index.html', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/geo.js', 'js/sim.js', 'js/fog.js', 'js/map.js', 'js/glass.js', 'js/speech.js',
  'js/stories.js', 'js/place.js', 'js/trips.js', 'js/waze.js', 'js/quests.js', 'js/quiz.js', 'js/sheets.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShell = e.request.method === 'GET' && (url.origin === location.origin || url.href.startsWith('https://cdn.jsdelivr.net/npm/maplibre-gl@'));
  if (!isShell) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
