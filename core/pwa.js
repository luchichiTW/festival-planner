/* Website only: offline service worker, quiet updates, and the walkthrough's 「加到主畫面」 step.
   Update rule: a new version downloads in the background (sw.js), and is switched in only when nobody is using
   the page — when the app goes to the background, or right as it is opened again, without a word (the 關於 sheet
   shows the version and the timetable date). Picks are in localStorage and are never touched by an update. */
(() => {
  const EVT = window.FP_EVENT;
  const FP = window.FP;
  if (!FP) return;
  const { store, key } = FP;

  /* ---------- the walkthrough's last step: add it to the home screen, use it offline ---------- */
  // For everyone not already in the installed app. On a phone it comes back, up to three times a day (on opening
  // the page, or on coming back to it after half an hour away), until it is on the home screen: getting it there
  // is the point. On a computer, once. What to tap depends on where the page is open: an app's built-in browser
  // can't install at all; iPhone uses Share (in Safari, the five steps as pictures: event.json "iosInstallSteps");
  // Chrome and Edge can show their own prompt.
  const KEY_INSTALL = key('install-hint');
  const PER_DAY = 3;
  const AWAY_MS = 30 * 60 * 1000;
  const t = FP.t;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Barcelona|MicroMessenger|; wv\)/.test(ua); // Instagram, Facebook, LINE, Threads, WeChat, Android web views
  const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Version\/[\d.]+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const phone = isIOS || isAndroid || inApp;
  const isSafari = isIOS && !inApp && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|YaBrowser|DuckDuckGo/.test(ua);
  const pictures = isSafari && (EVT.iosInstallSteps || []).length === 5 ? EVT.iosInstallSteps : null;
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
    const E = window.FP_EVENT;
    const offline = t('完全離線運作、不蒐集任何資料。');
    const links = [E.urls?.official && [E.urls.official, t('官方網站')], E.urls?.repo && [E.urls.repo, t('GitHub 原始碼')]].filter(Boolean);
    const tail = links.length ? `<p class="ob-links">${links.map(([u, l]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</p>` : '';
    let desc;
    if (inApp) {
      const url = location.origin + location.pathname;
      return `<p class="ob-desc">${t('你現在用的是 App 裡的瀏覽器，沒辦法加到主畫面。點右上角的三個點，選「用瀏覽器開啟」；或複製網址，貼到 Safari 或 Chrome，再加到主畫面。')}${offline}</p>
        <p class="ob-url">${esc(url)}</p><button type="button" class="pill-btn ob-copy" data-act="ob-copy">${t('複製網址')}</button>${tail}`;
    }
    const moved = isIOS && FP.snapshot().picks.length ? `<p class="ob-desc">${t('已經排好的團序，到「我的團序」按「複製備份連結」，再到主畫面版的「我的團序」選「從備份連結還原」。')}</p>` : '';
    if (pictures) return `<p class="ob-desc">${t('在 Safari 排好的團序，到主畫面還要再排一次。照下面 5 步加到主畫面，之後點圖示打開，離線也能用、不蒐集任何資料。')}</p>${guide()}${moved}${tail}`;
    if (isIOS) desc = t('記得先點「分享」→「加入主畫面」再開始排團，不然在 Safari 排好的團序，到主畫面還要再排一次喔！（新版 Safari 的「分享」在網址列旁的「⋯」裡）');
    else if (offer) desc = phone ? t('點下面的「安裝」，就會加到主畫面，之後從圖示打開。') : t('點下面的「安裝」，就會裝到電腦上，之後從圖示打開。');
    else if (isAndroid) desc = t('點瀏覽器右上角的三個點（⋮），選「加到主畫面」或「安裝應用程式」，之後從主畫面的圖示打開。');
    else if (isMacSafari) desc = t('在選單列點「檔案」→「加入 Dock」，之後從 Dock 打開。');
    else desc = t('用 Chrome 或 Edge 打開時，網址列右邊會有「安裝」圖示；其他瀏覽器打開過一次後也能離線看，記得加入書籤。');
    return `<p class="ob-desc">${desc}${offline}</p>${moved}${tail}`;
  }

  // Safari on iPhone: what to tap, as screenshots (iPhone 17 Pro, iOS 26), one per step, swiped sideways.
  function guide() {
    const say = [t('點網址列右邊的「⋯」'), t('點「分享」'), t('點「檢視較多」'), t('點「加入主畫面」'), t('點「加入」（網頁 App 保持開著）')];
    return `<div class="a2hs" role="group" aria-label="${esc(t('加到主畫面的 5 個步驟'))}"><div class="a2hs-track">${pictures.map((src, i) => `<figure class="a2hs-step"><img src="${esc(src)}" alt="" width="360" height="270" decoding="async"><figcaption><b>${i + 1}</b><span>${esc(say[i])}</span></figcaption></figure>`).join('')}</div>
      <div class="a2hs-dots" aria-hidden="true">${pictures.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div></div>
      <p class="a2hs-old">${t('舊版 iOS 的分享鈕在下方工具列，點它之後往下滑，找「加入主畫面」。')}</p>`;
  }
  // The dots follow the swipe; tapping a picture goes to the next one (the last one back to the first).
  const slide = (tr) => tr.clientWidth + (parseFloat(getComputedStyle(tr).columnGap) || 0);
  document.addEventListener('scroll', (e) => {
    const tr = e.target;
    if (!tr.classList || !tr.classList.contains('a2hs-track')) return;
    const i = Math.round(tr.scrollLeft / slide(tr));
    tr.parentNode.querySelectorAll('.a2hs-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
  }, true);
  document.addEventListener('click', (e) => {
    const fig = e.target.closest && e.target.closest('.a2hs-step');
    if (!fig) return;
    const tr = fig.parentNode;
    const i = fig.nextElementSibling ? [...tr.children].indexOf(fig) + 1 : 0;
    tr.scrollTo({ left: i * slide(tr), behavior: 'smooth' });
  });

  // Phones: { d: the day, n: times shown that day }. Computers: '1' once seen. (Before 1.6.1, '1' everywhere.)
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function shownToday() {
    try {
      const v = JSON.parse(store.get(KEY_INSTALL) || 'null');
      return v && v.d === today() ? v.n || 0 : 0;
    } catch (err) {
      console.warn('[fp] install-hint count unreadable, starting over', err);
      return 0;
    }
  }
  const due = () => (phone ? shownToday() < PER_DAY : !store.get(KEY_INSTALL));

  // On a phone the step stays registered even when today's three are used up: the page may stay open past midnight.
  if (!standalone && (phone || due())) {
    // Keep Chrome's own banner away while our step is still to come; the step offers the same prompt.
    // (iPhone and in-app browsers never offer one; their steps say what to tap instead.)
    if (!isIOS && !inApp && due()) addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e; FP.onboardRefresh('install'); });
    FP.onboardStep({
      id: 'install',
      icon: '📲',
      title: () => (isIOS ? t('先加主畫面再排團！') : phone ? t('加到主畫面，沒網路也能開') : t('安裝到電腦，沒網路也能開')),
      body: installBody,
      cta: () => (offer ? { act: 'ob-install', label: t('安裝') } : null),
      act: (name) => { if (name === 'ob-install') install(); else if (name === 'ob-copy') copyLink(); },
      due,
      seen: () => store.set(KEY_INSTALL, phone ? JSON.stringify({ d: today(), n: shownToday() + 1 }) : '1'),
    });
  }
  // Back on the page after half an hour away (Safari keeps the page open between visits): again, if still due.
  if (!standalone && phone) {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS && due()) FP.onboardStart();
      hiddenAt = 0;
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
