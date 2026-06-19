// Minimal service worker. Caches the app shell + static assets for fast/offline
// launch, but ALWAYS goes to the network for live weather data and images
// (/api/*, tiles, satellite/model imagery) so nothing weather-related is stale.
const CACHE = 'wx-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App shell: network-first (keeps UI current), fall back to cache offline.
  if (url.origin === location.origin && req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Static build assets: cache-first for instant launch.
  if (url.origin === location.origin && /\.(js|css|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (/api/*, radar tiles, satellite/model images, weather data):
  // straight to the network — never cached, always live.
});
