const CACHE_NAME = 'roofignite-v2-cache-v2';
const PRECACHE_URLS = [
  'dashboard.html',
  'account.html',
  'billing.html',
  'admin.html',
  'donttouch.html',
  'shared.min.js',
  'shared.css',
  'tailwind.built.css',
  'config.js',
];

// Install: precache all pages and assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache first, fall back to network, update cache in background
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache same-origin requests
  if (url.origin !== location.origin) return;

  // For HTML pages and our JS/CSS: cache-first with background update
  if (PRECACHE_URLS.some((p) => url.pathname.endsWith(p))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
        return cached || fetchPromise;
      })
    );
  }
});
