/* Website only: offline service worker, quiet updates, and the walkthrough's 「加到主畫面」 step.
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
  if (last && last !== EVT.build) setTimeout(() => FP.toast(FP.t('已更新到 {date} 的時間表', { date: FP.mmdd(EVT.dataDate) }), 4000), 500);

  /* ---------- the walkthrough's last step: add it to the home screen, use it offline ---------- */
  // Shown once, to everyone not already in the installed app. What to tap depends on where the page is open:
  // an app's built-in browser can't install at all, iPhone uses Share, Chrome and Edge can show their own prompt.
  const KEY_INSTALL = key('install-hint');
  const t = FP.t;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Barcelona|MicroMessenger|; wv\)/.test(ua); // Instagram, Facebook, LINE, Threads, WeChat, Android web views
  const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Version\/[\d.]+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const phone = isIOS || isAndroid || inApp;
  let offer = null; // Chrome / Edge's install prompt (beforeinstallprompt), once the browser makes one

  async function install() {
    const e = offer;
    offer = null;
    FP.closeSheet();
    if (!e) return;
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice && choice.outcome === 'accepted') FP.toast(t('安裝好了，之後點圖示就能打開'), 4000);
    } catch (err) {
      console.error('[fp] install prompt failed', err);
      FP.toast(t('沒辦法安裝，請從瀏覽器選單選「安裝」'), 4000);
    }
  }
  async function copyLink() {
    const url = location.origin + location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      FP.toast(t('已複製網址，貼到 Safari 或 Chrome 打開'), 3200);
    } catch (err) {
      console.error('[fp] copy failed', err);
      FP.toast(t('沒辦法自動複製，請長按上面的網址複製'), 3200);
    }
  }

  function installBody() {
    const icon = document.querySelector('link[rel="apple-touch-icon"]');
    const head = icon ? `<img class="ob-icon" src="${esc(icon.getAttribute('href'))}" alt="">` : '';
    const offline = `<p>${t('打開過一次之後，就算現場沒有網路，也能看時間表和你的團序。')}</p>`;
    const list = (items) => `<ol class="ob-steps">${items.map((x) => `<li>${x}</li>`).join('')}</ol>`;
    if (inApp) {
      const url = location.origin + location.pathname;
      return `${head}<p>${t('你現在用的是 App 裡的瀏覽器，沒辦法加到主畫面。')}</p>
        ${list([t('點右上角的三個點，選「用瀏覽器開啟」；或複製網址，貼到 Safari 或 Chrome。'), t('在瀏覽器裡再照著加到主畫面。')])}
        <p class="ob-url">${esc(url)}</p>
        <button type="button" class="pill-btn ob-copy" data-act="ob-copy">${t('複製網址')}</button>
        ${offline}`;
    }
    if (isIOS) {
      const moved = FP.snapshot().picks.length ? `<p>${t('已經排好的團序，到「我的團序」按「複製備份連結」，再到主畫面版的「我的團序」選「從備份連結還原」。')}</p>` : '';
      return `${head}${list([t('點瀏覽器的「分享」按鈕（新版 Safari 要先點網址列旁的「⋯」）。'), t('往下滑，點「加入主畫面」，再點「新增」。'), t('之後從主畫面的圖示打開。')])}
        <p class="ob-note"><b>${t('先加再排')}</b>${t('：Safari 裡排的團序不會帶到主畫面版。')}</p>${moved}
        ${offline}`;
    }
    if (offer) return `${head}<p>${phone ? t('點下面的「安裝」，就會加到主畫面。') : t('點下面的「安裝」，就會裝到電腦上。')}</p>${offline}`;
    if (isAndroid) return `${head}${list([t('點瀏覽器右上角的三個點（⋮），選「加到主畫面」或「安裝應用程式」。'), t('之後從主畫面的圖示打開。')])}${offline}`;
    if (isMacSafari) return `${head}${list([t('在選單列點「檔案」→「加入 Dock」。')])}${offline}`;
    return `${head}${list([t('用 Chrome 或 Edge 打開時，網址列右邊會有「安裝」圖示。'), t('其他瀏覽器打開過一次後也能離線看，記得加入書籤。')])}${offline}`;
  }

  if (!standalone && !store.get(KEY_INSTALL)) {
    // Keep Chrome's own banner away while our step is still to come; the step offers the same prompt.
    // (iPhone and in-app browsers never offer one; their steps say what to tap instead.)
    if (!isIOS && !inApp) addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e; FP.onboardRefresh('install'); });
    FP.onboardStep({
      id: 'install',
      keep: true, // 跳過 lands here: the one step worth not skipping
      title: () => (phone ? t('加到主畫面，沒網路也能開') : t('安裝到電腦，沒網路也能開')),
      body: installBody,
      cta: () => (offer ? { act: 'ob-install', label: t('安裝') } : null),
      act: (name) => { if (name === 'ob-install') install(); else if (name === 'ob-copy') copyLink(); },
      seen: () => store.set(KEY_INSTALL, '1'),
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
