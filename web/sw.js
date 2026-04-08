const CACHE_NAME = 'holo-card-v1';

const PRECACHE_URLS = [
  './',
  './style.css',
  './app.js',
  './i18n.js',
  './components/guides-view.js',
  './components/deck-view.js',
  './components/card-view.js',
  './components/tournament-view.js',
  './favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  if (url.pathname.startsWith('/data/')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  if (url.hostname === 'hololive-cardgame.github.io' ||
      url.hostname === 'www.holocardstrategy.jp' ||
      url.hostname === 'en.hololive-official-cardgame.com') {
    e.respondWith(cacheFirst(e.request, 7 * 24 * 60 * 60 * 1000));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(resp => {
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request, maxAge) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    const dateHeader = cached.headers.get('sw-cache-time');
    if (dateHeader && (Date.now() - parseInt(dateHeader)) < maxAge) {
      return cached;
    }
  }
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      const headers = new Headers(resp.headers);
      headers.set('sw-cache-time', String(Date.now()));
      const copy = new Response(await resp.blob(), { status: resp.status, statusText: resp.statusText, headers });
      cache.put(request, copy);
      return resp;
    }
    return cached || resp;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}
