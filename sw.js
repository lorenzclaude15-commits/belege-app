// Offline-Betrieb und Empfang von geteilten Dateien (z. B. aus Adobe Scan)
const VERSION = 'belege-v1';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'extract.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'vendor/tesseract.min.js', 'vendor/worker.min.js', 'vendor/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/core/tesseract-core-lstm.wasm.js', 'vendor/lang/deu.traineddata.gz', 'vendor/exceljs.min.js',
  'vendor/jszip.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'share-inbox').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const box = await caches.open('share-inbox');
      const files = form.getAll('files').filter(f => f && f.size);
      let i = 0;
      for (const f of files) {
        const key = new URL(`shared/${Date.now()}-${i++}`, self.registration.scope).href;
        await box.put(key, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'beleg') } }));
      }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
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
