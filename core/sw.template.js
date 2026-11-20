/* Service worker for one event, scope /<slug>/: the planner, or the lineup page before the timetable is out.
   scripts/build.mjs fills in the __PLACEHOLDERS__.
   - Install: download every file of this version into its own cache. Nothing switches until all of it is there.
   - Page (HTML): from this version's cache at once, whatever the network is doing. A version's page never changes,
     so the network has nothing newer to give it; a new deploy is a new sw.js, checked in the background on every
     open, downloaded whole, and switched in later (below). Not cached (the cache was cleared) → the network.
   - Everything else: from this version's cache. Other pages under the scope (artist pages, …) are left to the network.
   - A waiting new version takes over only when the page asks (core/offline.js sends SKIP_WAITING while nobody's
     using it). When the planner replaces the lineup page it is the same sw.js and cache prefix: it takes over the
     same way and clears the lineup page's cache. */
const VERSION = '__VERSION__'; // a new build changes this file, which is how the browser sees a new version
const CACHE = '__CACHE__';
const PREFIX = '__PREFIX__';
const FILES = __FILES__;
const SHELL = new URL('./', self.location).href;
const SCOPE_PATH = new URL('./', self.location).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Only this event's old caches: other events on the same site keep theirs.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  if (req.mode === 'navigate') {
    // Only the app page itself. Other pages under the scope (artist pages, the Claude page) are separate
    // documents: they go to the network as usual and are never answered with the app.
    if (url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`) e.respondWith(page(e));
    return;
  }
  e.respondWith(asset(req));
});

async function page(e) {
  const cached = await caches.match(SHELL, { cacheName: CACHE });
  if (!cached) return fetch(e.request);
  // Is there a newer version? Asked while the page is already showing; the browser downloads it in the background.
  e.waitUntil(self.registration.update().catch((err) => console.warn('[fp] update check failed; checked again on the next open', err)));
  return cached;
}

async function asset(req) {
  const hit = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
  return hit || fetch(req);
}
