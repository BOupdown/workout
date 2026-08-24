/*
 * Workout's service worker.
 *
 * The strategy, chosen so that offline capability costs nothing in freshness:
 *
 *   navigation (HTML)      network first, cache as a fallback
 *   /_next/static/…        cache first (hashed names, immutable content)
 *   manifest and icons     cache first, refreshed in the background
 *   everything else        network, not intercepted
 *
 * Network first on pages is the key point: online, the user always gets the
 * latest HTML, so updates stay as automatic as they were before this worker
 * existed. The cache only serves when the network fails.
 *
 * `skipWaiting()` is never called on its own. Swapping assets under a page
 * that is already loaded breaks chunk loading — and mid-session is the worst
 * possible moment for that. The switch is the user's to make, from the update
 * banner.
 */

const VERSION = 'v1';
const SHELL_CACHE = `workout-shell-${VERSION}`;
const ASSET_CACHE = `workout-assets-${VERSION}`;

/** The single route, so a first offline open succeeds. */
const SHELL_URLS = ['/'];

const STATIC_PATHS = ['/manifest.webmanifest', '/icon', '/apple-icon'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `addAll` fails as a whole if a single URL does: they are taken one by
      // one so that one unreachable page cannot fail the install.
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {})))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.endsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Only caches responses that are complete and servable. */
function isCacheable(response) {
  return response && response.status === 200 && response.type === 'basic';
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) || (await caches.match('/'));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (STATIC_PATHS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
