/*
 * Service worker: keeps the app shell so shaping opens offline.
 *
 * - Everything is addressed relative to the worker's scope, so it works under any base path
 *   (the app is served under /shaping/).
 * - Pages and other unhashed files: network first, falling back to the cached copy (so an update
 *   is picked up at the next visit while online, and the app still opens offline).
 * - Files under assets/ have content hashes in their names: cache first, filled as they are used.
 * - BUILD_ID is replaced at build time (see vite.config.ts). A new build changes this file, so the
 *   browser installs the new worker, which drops the caches of older builds. Safe to update: the
 *   new worker takes over at once, and a page never mixes files of two builds because hashed
 *   files never change and the page itself comes from the network when online.
 * - Nothing is ever sent anywhere: only same-origin GET requests are handled.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE = `shaping-${BUILD_ID}`;
const SCOPE = self.registration.scope;
const SHELL = ['./', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
const HASHED = new URL('assets/', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new URL(p, SCOPE).href))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shaping-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function remember(request, response) {
  if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

const cacheFirst = async (request) => (await caches.match(request)) ?? remember(request, await fetch(request));

async function networkFirst(request) {
  // Every page address (whatever its query string, which may hold a shared design) is one cached shell.
  const key = request.mode === 'navigate' ? new URL('./', SCOPE).href : request;
  try {
    return await remember(key, await fetch(request));
  } catch (err) {
    // Offline: the cached copy.
    const cached = await caches.match(key);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  event.respondWith(request.url.startsWith(HASHED) ? cacheFirst(request) : networkFirst(request));
});
