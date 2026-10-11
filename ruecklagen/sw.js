// Offline-Betrieb: App-Dateien liegen im Cache, Daten nur verschlüsselt im Browser-Speicher
const VERSION = 'ruecklagen-v2';
const FILES = [
  './', 'index.html', 'style.css', 'calc.js', 'store.js', 'sync.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'vendor/exceljs.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch (err) {
      if (e.request.mode === 'navigate') return cache.match('index.html');
      throw err;
    }
  })());
});
