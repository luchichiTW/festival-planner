/* Adding the page to the Home Screen, shared by the planner's walkthrough (core/pwa.js) and the lineup page
   (core/lineup.js): where the page is open, and Safari's five steps on an iPhone as pictures, swiped sideways. On an
   iPhone, Safari and the Home Screen app keep separate storage: what is picked or marked in one isn't in the other. */
(() => {
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Barcelona|MicroMessenger|; wv\)/.test(ua); // Instagram, Facebook, LINE, Threads, WeChat, Android web views
  const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Version\/[\d.]+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const isSafari = isIOS && !inApp && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|YaBrowser|DuckDuckGo/.test(ua);
  // iPhone Duo: its screen reports 466 × 678 points whichever screen is lit; the iPhone-shaped pictures don't fit it.
  const isDuo = isIOS && Math.min(screen.width, screen.height) === 466 && Math.max(screen.width, screen.height) === 678;
  // iOS 27 took ⋯ away from the address bar: Share comes from pressing and holding the address. Before it, Share is under
  // ⋯ on the right of the bar. Safari's Version/ is the iOS version (Safari only updates with iOS; since iOS 26 the OS
  // part of its user agent stays at 18_x). Not there (another browser) → the newest steps. The Duo only runs iOS 27+.
  const safariMajor = Number((/Version\/(\d+)/.exec(ua) || [])[1]) || 0;
  const beforeIOS27 = isIOS && !isDuo && safariMajor > 0 && safariMajor < 27;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Safari on iPhone: what to tap, as screenshots (iPhone 17 Pro), one per step: event.json "iosInstallSteps" (iOS 27.2)
  // or "iosInstallStepsBefore27" (iOS 26.5). Null when the page isn't open in Safari or the event has no pictures.
  function pictures(steps, before27) {
    const set = beforeIOS27 && (before27 || []).length === 5 ? before27 : steps;
    return isSafari && (set || []).length === 5 ? set : null;
  }
  // The steps under the pictures; on an iPhone Duo, the same steps in words. Before iOS 27, a line for older iOS still,
  // where Share is in the toolbar at the bottom.
  function guide(pictures, t) {
    const say = [beforeIOS27 ? t('點網址列右邊的「⋯」') : t('長按網址'), t('點「分享」'), t('點「檢視較多」'), t('點「加入主畫面」'), t('點「加入」（網頁 App 保持開著）')];
    if (isDuo) return `<ol class="a2hs-list" aria-label="${esc(t('加到主畫面的 5 個步驟'))}">${say.map((s, i) => `<li><b>${i + 1}</b><span>${esc(s)}</span></li>`).join('')}</ol>`;
    return `<div class="a2hs" role="group" aria-label="${esc(t('加到主畫面的 5 個步驟'))}"><div class="a2hs-track">${pictures.map((src, i) => `<figure class="a2hs-step"><img src="${esc(src)}" alt="" width="360" height="270" decoding="async"><figcaption><b>${i + 1}</b><span>${esc(say[i])}</span></figcaption></figure>`).join('')}</div>
      <div class="a2hs-dots" aria-hidden="true">${pictures.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div></div>
      ${beforeIOS27 ? `<p class="a2hs-old">${t('舊版 iOS 的分享鈕在下方工具列，點它之後往下滑，找「加入主畫面」。')}</p>` : ''}`;
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

  // How many times the add-to-Home-Screen card was shown today ({ d: the day, n: times }; '1' on a computer, once).
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function shownToday(raw) {
    try {
      const v = JSON.parse(raw || 'null');
      return v && v.d === today() ? v.n || 0 : 0;
    } catch (err) {
      console.warn('[fp] install-hint count unreadable, starting over', err);
      return 0;
    }
  }
  const countShown = (raw) => JSON.stringify({ d: today(), n: shownToday(raw) + 1 });

  window.FP_A2HS = { isIOS, isAndroid, inApp, isMacSafari, standalone, isSafari, isDuo, beforeIOS27, phone: isIOS || isAndroid || inApp, pictures, guide, shownToday, countShown };
})();
