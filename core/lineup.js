/* festival-planner: the "status": "lineup" page — the acts announced so far, before the timetable is out.
   The names are in the HTML (scripts/build.mjs writes them, so readers without JavaScript see the lineup); this script
   adds English, the theme switch, the artist card (a tap or a long press on an act, in the same shape as the
   planner's card in core/app.js) and 想看: acts marked on this phone, which the planner adds to the picks once the
   timetable is out. Data: window.FP_LINEUP (event.json, data/lineup.json, data/artists.json). */
(() => {
  const L = window.FP_LINEUP;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (name) => `fp:${L.slug}:${name}`;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: the choice lasts this visit */ } },
  };

  // Language: the same key and rule as the planner (Chinese unless EN was picked; switching reloads), so the choice
  // carries over when this page becomes the planner.
  const lang = (L.languages || ['zh']).includes(store.get(key('lang'))) ? store.get(key('lang')) : 'zh';
  const DICT = lang === 'zh' ? null : (window.FP_I18N && window.FP_I18N[lang]) || null;
  function t(zh, vars) {
    const s = (DICT && DICT[zh]) || zh;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
  }
  const nameOf = (a) => (lang === 'en' && a.en) || a.name;
  const altOf = (a) => (lang === 'en' ? (a.en ? a.name : '') : a.en || '');
  const dateText = lang === 'en' ? L.dataDate : L.dataDate.split('-').map(Number).join('/');

  if (lang === 'en') {
    root.lang = 'en';
    if (L.wordmark?.textEn) $('wordmarkText').textContent = L.wordmark.textEn;
    if (L.subtitleEn) $('topSub').textContent = L.subtitleEn;
    $('luTitle').textContent = t('已公布陣容');
    $('luSub').textContent = t('{n} 組・{date} 更新', { n: L.acts.length, date: dateText });
    $('luIntro').textContent = t('先標想看的團，時間表公布後會自動排進團序。');
    document.querySelectorAll('.lu-tile').forEach((li) => {
      const a = L.acts[Number(li.dataset.i)];
      li.querySelector('.lu-open').innerHTML = `<b>${esc(nameOf(a))}</b>${altOf(a) ? `<i>${esc(altOf(a))}</i>` : ''}`;
      li.querySelector('.lu-want span').textContent = t('想看');
      li.querySelector('.lu-want').setAttribute('aria-label', t('想看：{name}', { name: nameOf(a) }));
    });
    const demoBtn = $('luDemoBtn');
    if (demoBtn && L.demo) {
      demoBtn.textContent = t('用{name}試玩', { name: L.demo.nameEn || L.demo.name });
      document.querySelectorAll('.lu-demo img').forEach((img) => { img.alt = t('{name} 排團工具的時間表畫面', { name: L.demo.nameEn || L.demo.name }); });
    }
    $('luSource').textContent = L.sourceNoteEn || L.sourceNote;
    $('luDisclaimer').textContent = L.disclaimerEn;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.textContent); });
    const search = $('luSearch');
    if (search) { search.placeholder = t('搜尋藝人'); search.setAttribute('aria-label', t('搜尋藝人')); }
  }
  const langBtn = $('langBtn');
  if (langBtn) {
    langBtn.textContent = lang === 'en' ? '中' : 'EN';
    langBtn.setAttribute('aria-label', lang === 'en' ? '切換成中文' : t('切換成英文'));
    langBtn.addEventListener('click', () => { store.set(key('lang'), lang === 'en' ? 'zh' : 'en'); location.reload(); });
  }

  /* ---------- theme: the planner's rule — flip light ↔ dark; flipping to what the system shows follows it again ---------- */
  const themeBtn = $('themeBtn');
  const saved = store.get(key('theme'));
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  const systemTheme = () => (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const effectiveTheme = () => root.getAttribute('data-theme') || systemTheme();
  function syncThemeBtn() {
    const m = effectiveTheme();
    themeBtn.dataset.mode = m;
    themeBtn.setAttribute('aria-label', m === 'dark' ? t('切換成淺色模式') : t('切換成深色模式'));
  }
  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    if (next === systemTheme()) { root.removeAttribute('data-theme'); store.set(key('theme'), 'system'); }
    else { root.setAttribute('data-theme', next); store.set(key('theme'), next); }
    syncThemeBtn();
  });
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncThemeBtn); } catch (e) { /* old Safari: the button still works */ }
  syncThemeBtn();

  /* ---------- 想看: acts marked on this phone, by their id; the planner adds their sets to the picks later ---------- */
  const KEY_WANT = key('want');
  const want = (() => {
    try {
      const raw = JSON.parse(store.get(KEY_WANT) || 'null');
      return Array.isArray(raw?.ids) ? raw.ids.filter((id) => typeof id === 'string') : [];
    } catch (e) { return []; }
  })();
  const app = document.querySelector('.lu-app');
  const dock = $('luDock');
  const bar = $('luBar');
  // The acts scroll clear of whatever sits at the bottom (the count, the search field): its height, kept current.
  const fitDock = () => app.style.setProperty('--dock', `${dock.offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(fitDock).observe(dock);
  function renderWant() {
    const on = new Set(want);
    document.querySelectorAll('.lu-tile').forEach((li) => {
      li.querySelector('.lu-want').setAttribute('aria-pressed', String(on.has(L.acts[Number(li.dataset.i)].id)));
    });
    // Only the acts still on this lineup count (an act the festival took off keeps its mark, unseen).
    const n = L.acts.filter((a) => on.has(a.id)).length;
    bar.hidden = !n;
    if (n) bar.innerHTML = `<b>${esc(t('已標 {n} 組想看', { n }))}</b><span>${esc(t('時間表公布後自動排進團序'))}</span>`;
    fitDock();
  }
  document.querySelectorAll('.lu-want').forEach((b) => { b.hidden = false; });
  $('luIntro').hidden = false;
  $('luGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.lu-want');
    if (!b) return;
    const id = L.acts[Number(b.closest('.lu-tile').dataset.i)].id;
    const at = want.indexOf(id);
    if (at >= 0) want.splice(at, 1);
    else want.push(id);
    store.set(KEY_WANT, JSON.stringify({ v: 1, ids: want, t: Date.now() }));
    renderWant();
    if (at < 0) askHomeScreen(b);
  });
  renderWant();

  /* ---------- artist card ---------- */
  const LP_MS = 450;
  const lpCard = $('lpCard');
  const lpBackdrop = $('lpBackdrop');
  // The links the festival lists, as a row of round buttons at the foot of the card: the platform's mark drawn as a
  // one-colour line glyph, its name under it.
  const LINKS = {
    facebook: ['Facebook', '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 7.6h-1.3c-1.3 0-2.1.8-2.1 2.1v10.8M9.6 12.6h5.4"/>'],
    instagram: ['Instagram', '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/>'],
    youtube: ['YouTube', '<rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="M10.5 9.5v5l4.2-2.5z"/>'],
    x: ['X', '<path d="M4.5 4.5h4.2l10.8 15h-4.2z"/><path d="M18.8 4.5l-5.6 6.3M10.8 13.2l-5.6 6.3"/>'],
    official: ['官方網站', '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5z"/>'],
  };
  const glyph = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  let lpOpener = null;
  let lpCloseTimer = null;
  let lpHold = false;
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  function bioHtml(a) {
    if (!a.bio) return `<p class="lp-none">${t('目前沒有找到可靠的介紹資料。')}</p>`;
    const srcs = (a.sources || []).map((u) => (hostOf(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(hostOf(u))}</a>` : '')).filter(Boolean);
    return `<p class="lu-bio" lang="zh-Hant">${esc(a.bio)}</p>${srcs.length ? `<div class="lp-src">${t('資料來源：')}${srcs.join(' ')}</div>` : ''}`;
  }

  function openArtist(i, opener, holding) {
    const a = L.acts[i];
    if (!a) return;
    // In the order the festival's page lists them (lineup.json keeps that order).
    const links = Object.keys(a.links || {}).filter((k) => LINKS[k]).map((k) => {
      const [label, paths] = LINKS[k];
      return `<a href="${esc(a.links[k])}" target="_blank" rel="noopener"><span class="lu-ico">${glyph(paths)}</span><span>${esc(k === 'official' ? t(label) : label)}</span></a>`;
    }).join('');
    showCard(`
      <span class="lu-tba">${t('舞台和時間待公布')}</span>
      <button type="button" class="sr-only" data-lp="close">${t('關閉')}</button>
      <h2 class="lp-name" id="lpName">${esc(nameOf(a))}</h2>
      ${altOf(a) ? `<p class="lp-note">${esc(altOf(a))}</p>` : ''}
      ${bioHtml(a)}
      ${links ? `<nav class="lu-links" aria-label="${t('官方連結')}">${links}</nav>` : ''}`, opener, holding);
  }
  // The centred card: an act, or the Home Screen steps. Focus goes back to what opened it when it closes.
  function showCard(html, opener, holding) {
    clearTimeout(lpCloseTimer);
    lpOpener = opener || null;
    lpCard.innerHTML = html;
    root.classList.add('lu-locked');
    lpBackdrop.classList.remove('out');
    lpCard.classList.remove('out');
    // While the finger that opened the card is still down, its release must not land on a link or the backdrop.
    lpHold = !!holding;
    const pe = holding ? 'none' : '';
    lpBackdrop.style.pointerEvents = pe;
    lpCard.style.pointerEvents = pe;
    if (holding) setTimeout(releaseHold, 1500);
    lpBackdrop.hidden = false;
    lpCard.hidden = false;
    lpCard.scrollTop = 0;
    lpCard.setAttribute('tabindex', '-1');
    lpCard.focus({ preventScroll: true });
  }
  function releaseHold() {
    if (!lpHold) return;
    lpHold = false;
    setTimeout(() => { lpBackdrop.style.pointerEvents = ''; lpCard.style.pointerEvents = ''; }, 80);
  }
  document.addEventListener('pointerup', releaseHold, true);
  document.addEventListener('pointercancel', releaseHold, true);
  // Focus goes back to the act that opened the card (keyboards and screen readers carry on from there); after a touch
  // or a click it comes back without a focus ring, the way an iPhone app looks.
  let byPointer = false;
  document.addEventListener('pointerdown', () => { byPointer = true; }, true);
  document.addEventListener('keydown', () => { byPointer = false; }, true);
  function closeArtist() {
    if (lpCard.hidden) return;
    const done = () => {
      lpBackdrop.hidden = true;
      lpCard.hidden = true;
      lpCard.innerHTML = '';
      root.classList.remove('lu-locked');
      const back = lpOpener;
      if (!back || !document.contains(back)) return;
      if (byPointer) {
        back.classList.add('no-ring');
        back.addEventListener('blur', () => back.classList.remove('no-ring'), { once: true });
      }
      back.focus({ preventScroll: true });
    };
    if (reduceMotion()) { done(); return; }
    lpBackdrop.classList.add('out');
    lpCard.classList.add('out');
    lpCloseTimer = setTimeout(done, 200);
  }
  lpBackdrop.addEventListener('click', closeArtist);

  /* ---------- on an iPhone, the day's first 想看 asks to add the page to the Home Screen first ---------- */
  // Safari and the Home Screen app keep separate storage, so marks made in Safari never reach the app (and the
  // planner it becomes). Once a day (the planner's count, fp:<slug>:install-hint); not in the app itself, nor in an
  // app's built-in browser, which can't add to the Home Screen. Computers and Android keep one storage: no card.
  const A2HS = window.FP_A2HS;
  const KEY_INSTALL = key('install-hint');
  function askHomeScreen(opener) {
    if (!A2HS || !A2HS.isIOS || A2HS.standalone || A2HS.inApp) return;
    if (A2HS.shownToday(store.get(KEY_INSTALL)) >= 1) return;
    store.set(KEY_INSTALL, A2HS.countShown(store.get(KEY_INSTALL)));
    const pictures = A2HS.isSafari && (L.iosInstallSteps || []).length === 5 ? L.iosInstallSteps : null;
    showCard(`<div class="lu-a2hs">
      <h2 class="lp-name" id="lpName">${t('先加主畫面再標想看！')}</h2>
      <p class="lu-a2hs-desc">${pictures ? t('在 Safari 標的想看，到主畫面不會跟過去。照下面 5 步加到主畫面，之後點圖示打開再標。') : t('記得先點「分享」→「加入主畫面」，從圖示打開再標想看；在瀏覽器標的，到主畫面不會跟過去。')}</p>
      ${pictures ? A2HS.guide(pictures, t) : ''}
      <button type="button" class="lu-ok" data-lp="close" aria-label="${esc(t('知道了'))}">👌</button></div>`, opener, false);
  }
  lpCard.addEventListener('click', (e) => { if (e.target.closest('[data-lp="close"]')) closeArtist(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeArtist(); });

  /* ---------- tap or long press an act ---------- */
  const grid = $('luGrid');
  const press = { timer: null, vis: null, x: 0, y: 0, el: null, fired: 0, type: '' };
  function cancelPress() {
    clearTimeout(press.timer);
    clearTimeout(press.vis);
    press.timer = null;
    if (press.el) press.el.classList.remove('pressing');
  }
  grid.addEventListener('pointerdown', (e) => {
    press.type = e.pointerType;
    const tile = e.target.closest('.lu-tile');
    if (!tile || e.target.closest('.lu-want') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    cancelPress();
    press.fired = 0;
    press.el = tile;
    press.x = e.clientX;
    press.y = e.clientY;
    press.vis = setTimeout(() => tile.classList.add('pressing'), 140);
    press.timer = setTimeout(() => {
      press.timer = null;
      press.fired = Date.now();
      tile.classList.remove('pressing');
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* no haptics on this device */ }
      openArtist(Number(tile.dataset.i), tile.querySelector('.lu-open'), true);
    }, LP_MS);
  });
  grid.addEventListener('pointermove', (e) => { if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress(); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) grid.addEventListener(type, cancelPress);
  grid.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('.lu-tile');
    if (!tile || e.target.closest('.lu-want')) return;
    e.preventDefault();
    // Desktop: right-click opens the card. Touch long presses are handled by the timer.
    if (press.type === 'mouse') openArtist(Number(tile.dataset.i), tile.querySelector('.lu-open'), false);
  });
  grid.addEventListener('click', (e) => {
    const open = e.target.closest('.lu-open');
    if (!open) return;
    // The release that ends a long press is not a tap.
    if (press.fired && Date.now() - press.fired < 1000) { press.fired = 0; return; }
    openArtist(Number(open.closest('.lu-tile').dataset.i), open, false);
  });

  /* ---------- search (only once the lineup is long: the build adds the field) ---------- */
  const search = $('luSearch');
  if (search) {
    const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const empty = $('luEmpty');
    search.addEventListener('input', () => {
      const q = fold(search.value);
      let shown = 0;
      document.querySelectorAll('.lu-tile').forEach((li) => {
        const a = L.acts[Number(li.dataset.i)];
        const hit = !q || fold(a.name).includes(q) || fold(a.en).includes(q);
        li.hidden = !hit;
        if (hit) shown += 1;
      });
      empty.hidden = shown > 0;
      if (!shown) empty.textContent = t('找不到「{q}」。試試別的寫法，或用英文名。', { q: search.value.trim() });
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') search.blur(); });
    // iOS keeps a fixed bar under the keyboard: lift it by the keyboard's height while typing.
    const vv = window.visualViewport;
    if (vv) {
      const lift = () => root.style.setProperty('--kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`);
      vv.addEventListener('resize', lift);
      vv.addEventListener('scroll', lift);
    }
  }
})();
