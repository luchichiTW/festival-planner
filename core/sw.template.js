/* Service worker for one event, scope /<slug>/. scripts/build.mjs fills in the __PLACEHOLDERS__.
   - Install: download every file of this version into its own cache. Nothing switches until all of it is there.
   - Page (HTML): network first, ~3 s, so online opens reach the server; but only a page of THIS version is used.
     A newer page means a new deploy: start downloading it in the background and keep serving the cached page,
     so old and new files never mix. Offline or slow → the cached page.
   - Everything else: from this version's cache. Other pages under the scope (artist pages, …) are left to the network.
   - A waiting new version takes over only when the page asks (pwa.js sends SKIP_WAITING while nobody's using it). */
const VERSION = '__VERSION__';
const CACHE = '__CACHE__';
const PREFIX = '__PREFIX__';
const FILES = __FILES__;
const NAV_TIMEOUT_MS = 3000;
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
    if (url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`) e.respondWith(page(req));
    return;
  }
  e.respondWith(asset(req));
});

function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

async function page(req) {
  const cached = await caches.match(SHELL, { cacheName: CACHE });
  if (!cached) return fetch(req);
  try {
    // By URL: a navigation Request can't be re-fetched with options. A redirected answer can't serve a navigation.
    const res = await within(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }), NAV_TIMEOUT_MS);
    if (res.ok && !res.redirected && (res.headers.get('content-type') || '').includes('text/html')) {
      const m = /<meta name="fp-build" content="([^"]*)"/.exec(await res.clone().text());
      if (m && m[1] === VERSION) return res;
      if (m) self.registration.update().catch(() => { /* retried on the next open */ });
    }
  } catch (err) {
    // offline or slower than NAV_TIMEOUT_MS: the cached page below
  }
  return cached;
}

async function asset(req) {
  const hit = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
  return hit || fetch(req);
}
