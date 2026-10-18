/* Website only: offline service worker, quiet updates, and the iPhone 「加入主畫面」 hint.
   Update rule: a new version downloads in the background (sw.js), and is switched in only when nobody is using
   the page — when the app goes to the background, or right as it is opened again. Then a toast says which
   timetable date is showing. Picks are in localStorage and are never touched by an update. */
(() => {
  const EVT = window.FP_EVENT;
  const FP = window.FP;
  if (!FP) return;
  const { store, key } = FP;

  /* ---------- "已更新" after a new version took over ---------- */
  const KEY_BUILD = key('build');
  const last = store.get(KEY_BUILD);
  store.set(KEY_BUILD, EVT.build);
  if (last && last !== EVT.build) setTimeout(() => FP.toast(`已更新到 ${FP.mmdd(EVT.dataDate)} 的時間表`, 4000), 500);

  /* ---------- iPhone: add to home screen first ---------- */
  const KEY_INSTALL = key('install-hint');
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const hint = document.getElementById('installHint');
  if (hint && isIOS && !standalone && !store.get(KEY_INSTALL)) {
    hint.hidden = false;
    // One hint at a time: the first-use coach comes back once this one is dismissed.
    const coach = document.getElementById('coach');
    const coachWaits = coach && !coach.hidden;
    if (coachWaits) coach.hidden = true;
    document.getElementById('installOk').addEventListener('click', () => {
      hint.hidden = true;
      store.set(KEY_INSTALL, '1');
      if (coachWaits && !store.get(key('hint-seen'))) coach.hidden = false;
    });
  }

  /* ---------- service worker ---------- */
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

  // A new version finishing its download while the page was just opened takes over at once.
  const watch = (nw) => {
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      if (nw.state === 'installed' && sw.controller && justOpened()) apply();
    });
  };
  sw.register('sw.js').then((r) => {
    reg = r;
    if (r.waiting && justOpened()) apply();
    watch(r.installing); // the page load itself may already have started an update
    r.addEventListener('updatefound', () => watch(r.installing));
  }).catch((e) => console.warn('[fp] service worker not registered; the page still works online', e));
})();
