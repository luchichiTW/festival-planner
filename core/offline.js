/* Website only, the planner and the lineup page: the offline service worker (sw.js) and quiet updates.
   The page opens from this phone's copy at once. A new version downloads in the background and is switched in only
   when nobody is using the page — when the app goes to the background, or right as it is opened again — without a
   word (the planner's 關於 sheet shows the version). Picks and 想看 marks are in localStorage, never touched by it. */
(() => {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  let reg = null;
  let pendingReload = false;
  // "Just opened": visible for under 4 s with no tap or key yet — switching versions now interrupts nothing.
  let visibleSince = performance.now();
  let touched = false;
  const justOpened = () => document.visibilityState === 'visible' && !touched && performance.now() - visibleSince < 4000;
  ['pointerdown', 'keydown'].forEach((t) => addEventListener(t, () => { touched = true; }, { capture: true, passive: true }));

  const reload = () => { pendingReload = false; location.reload(); };
  const apply = () => { if (reg && reg.waiting && sw.controller) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); };
  const check = () => { if (reg) reg.update().catch((e) => console.warn('[fp] update check failed, will retry', e)); };

  sw.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install: this page already is the newest version
    pendingReload = true;
    if (document.visibilityState === 'hidden' || justOpened()) reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (pendingReload) reload();
      else apply();
    } else {
      visibleSince = performance.now();
      touched = false;
      if (pendingReload) reload();
      else if (reg && reg.waiting) apply();
      else check();
    }
  });
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 30 * 60 * 1000);

  // A new version finishing its download while the page was just opened takes over at once — once the page has
  // loaded and gone quiet. Chrome stops the old worker the moment the switch is asked for; a request reaching it
  // right then (the browser fetches the favicon and manifest icons just after a load) restarts it, and the switch
  // then waits out the restarted worker's 30 s idle timeout, long after "just opened".
  const settled = new Promise((r) => {
    if (document.readyState === 'complete') r();
    else addEventListener('load', () => r(), { once: true });
  }).then(() => new Promise((r) => setTimeout(r, 1000)));
  const applyIfJustOpened = () => settled.then(() => { if (justOpened()) apply(); });
  const watch = (nw) => {
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      if (nw.state === 'installed' && sw.controller && justOpened()) applyIfJustOpened();
    });
  };
  sw.register('sw.js').then((r) => {
    reg = r;
    if (r.waiting && justOpened()) applyIfJustOpened();
    watch(r.installing); // the page load itself may already have started an update
    r.addEventListener('updatefound', () => watch(r.installing));
  }).catch((e) => console.warn('[fp] service worker not registered; the page still works online', e));
})();
