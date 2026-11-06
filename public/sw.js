/* Service worker. The server stamps BUILD with a hash of the public files, so
   every deploy gets a fresh cache and old ones are dropped.
   - Pages: network first, fall back to the cached shell when offline.
   - Static files: cache first (they're versioned), refreshed in the background.
   - /api/*: never touched. Scores and live rooms must always be live. */
const BUILD = '__BUILD__';
const CACHE = `ttl-${BUILD}`;
const SHELL = ['/', '/styles.css', '/field.js', '/live.js', '/fantasy.js', '/predict.js', '/bets.js', '/tour.js', '/app.js', '/pwa.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ttl-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/').then((r) => r || new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain' } }))),
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }),
  );
});
