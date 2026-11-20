/* Website only: the walkthrough's 「加到主畫面」 step. The offline service worker and quiet updates: core/offline.js. */
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
  // Where the page is open, Safari's steps as pictures and today's count: core/a2hs.js (shared with the lineup page).
  const A2HS = window.FP_A2HS;
  const { isIOS, isAndroid, inApp, isMacSafari, standalone, phone } = A2HS;
  const pictures = A2HS.pictures(EVT.iosInstallSteps, EVT.iosInstallStepsBefore27);
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
    const offline = t('完全離線運作、不蒐集任何資料。');
    let desc;
    if (inApp) {
      const url = location.origin + location.pathname;
      return `<p class="ob-desc">${t('你現在用的是 App 裡的瀏覽器，沒辦法加到主畫面。點右上角的三個點，選「用瀏覽器開啟」；或複製網址，貼到 Safari 或 Chrome，再加到主畫面。')}${offline}</p>
        <p class="ob-url">${esc(url)}</p><button type="button" class="pill-btn ob-copy" data-act="ob-copy">${t('複製網址')}</button>`;
    }
    const moved = isIOS && FP.snapshot().picks.length ? `<p class="ob-desc">${t('已經排好的團序，到「我的團序」按「複製備份連結」，再到主畫面版的「我的團序」選「從備份連結還原」。')}</p>` : '';
    if (pictures) return `<p class="ob-desc">${t('在 Safari 排好的團序，到主畫面還要再排一次。照下面 5 步加到主畫面，之後點圖示打開，離線也能用、不蒐集任何資料。')}</p>${guide()}${moved}`;
    if (isIOS) desc = t('記得先點「分享」→「加入主畫面」再開始排團，不然在 Safari 排好的團序，到主畫面還要再排一次喔！（新版 Safari 長按網址就有「分享」）');
    else if (offer) desc = phone ? t('點下面的「安裝」，就會加到主畫面，之後從圖示打開。') : t('點下面的「安裝」，就會裝到電腦上，之後從圖示打開。');
    else if (isAndroid) desc = t('點瀏覽器右上角的三個點（⋮），選「加到主畫面」或「安裝應用程式」，之後從主畫面的圖示打開。');
    else if (isMacSafari) desc = t('在選單列點「檔案」→「加入 Dock」，之後從 Dock 打開。');
    else desc = t('用 Chrome 或 Edge 打開時，網址列右邊會有「安裝」圖示；其他瀏覽器打開過一次後也能離線看，記得加入書籤。');
    return `<p class="ob-desc">${desc}${offline}</p>${moved}`;
  }

  const guide = () => A2HS.guide(pictures, t);

  // Phones: { d: the day, n: times shown that day }. Computers: '1' once seen. (Before 1.6.1, '1' everywhere.)
  const shownToday = () => A2HS.shownToday(store.get(KEY_INSTALL));
  const due = () => (phone ? shownToday() < PER_DAY : !store.get(KEY_INSTALL));

  // On a phone the step stays registered even when today's three are used up: the page may stay open past midnight.
  // Not while trying out a past event (?try): that visit is to see how it works, not to install it.
  if (!standalone && !FP.trying && (phone || due())) {
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
      seen: () => store.set(KEY_INSTALL, phone ? A2HS.countShown(store.get(KEY_INSTALL)) : '1'),
    });
  }
  // Back on the page after half an hour away (Safari keeps the page open between visits): again, if still due.
  if (!standalone && !FP.trying && phone) {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS && due()) FP.onboardStart();
      hiddenAt = 0;
    });
  }
})();
