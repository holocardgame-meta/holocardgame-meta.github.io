const CACHE_NAME = 'holo-card-v41';

const PRECACHE_URLS = [
  './',
  './zh-TW/',
  './ja/',
  './en/',
  './fr/',
  './es/',
  './privacy.html',
  './style.css',
  './app.js',
  './seo-config.mjs',
  './i18n.js',
  './utils/sanitize.js',
  './utils/colors.js',
  './utils/aliases.js',
  './components/guides-view.js',
  './components/deck-view.js',
  './components/card-view.js',
  './components/tournament-view.js',
  './components/rules-view.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
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
    e.respondWith(staleWhileRevalidate(e.request));
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

async function cacheFirst(request, maxAge) {
  const cache = await caches.open(CACHE_NAME);
  const metaRequest = cacheMetaRequest(request);
  const cached = await cache.match(request);
  if (cached) {
    const meta = await cache.match(metaRequest);
    const cachedAt = meta ? Number(await meta.text()) : 0;
    if (cachedAt && (Date.now() - cachedAt) < maxAge) {
      return cached;
    }
  }
  try {
    const resp = await fetch(request);
    if (resp.ok || resp.type === 'opaque') {
      await Promise.all([
        cache.put(request, resp.clone()),
        cache.put(metaRequest, new Response(String(Date.now()))),
      ]);
      return resp;
    }
    return cached || resp;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

function cacheMetaRequest(request) {
  const metaUrl = new URL('__sw-cache-meta?url=' + encodeURIComponent(request.url), self.registration.scope);
  return new Request(metaUrl.toString());
}
