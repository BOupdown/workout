/*
 * Service worker de Workout.
 *
 * Stratégie choisie pour ne PAS sacrifier la fraîcheur à l'autonomie :
 *
 *   navigation (HTML)      réseau d'abord, cache en secours
 *   /_next/static/…        cache d'abord (noms hachés, contenu immuable)
 *   manifeste et icônes    cache d'abord, rafraîchi en arrière-plan
 *   le reste               réseau, sans interception
 *
 * Le réseau d'abord sur les pages est le point clé : en ligne, l'utilisateur
 * reçoit toujours le dernier HTML, donc les mises à jour restent automatiques
 * comme avant ce worker. Le cache ne sert que lorsque le réseau échoue.
 *
 * `skipWaiting()` n'est jamais appelé tout seul. Échanger les assets sous une
 * page déjà chargée casse le chargement des chunks — au milieu d'une séance,
 * ce serait le pire moment. C'est l'utilisateur qui déclenche la bascule,
 * depuis le bandeau de mise à jour.
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
      // `addAll` échoue en bloc si une seule URL tombe : on les prend une par
      // une pour qu'une page indisponible ne fasse pas rater l'installation.
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

/** Ne met en cache que des réponses complètes et servables. */
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
