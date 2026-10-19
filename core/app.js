/* festival-planner core: stage × time board, my picks with clashes and backups (備選), lottery,
   long-press artist cards, search, the festival-day "now" line and next-up bar.
   Everything event-specific comes from window.FP_EVENT (built from event.json) and window.FP_DATA
   (data/schedule.json, data/artists.json); scripts/build.mjs puts both in data.js. Plain script, no framework.
   Optional add-ons talk to it through window.FP: pwa.js (website) and cloud.js (Claude artifact). */
(() => {
  const EVT = window.FP_EVENT;
  const DATA = window.FP_DATA;
  const PX = 2; // px per minute
  const key = (name) => `fp:${EVT.slug}:${name}`;
  const KEY_HINT = key('hint-seen');
  const KEY_PICKS = key('picks');
  const KEY_VIEW = key('view');
  const KEY_THEME = key('theme');
  const KEY_SEEN = key('seen-link');

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmt = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  // Language: Chinese unless the visitor picked English with EN／中 (offered when event.json "languages" has "en";
  // the choice is remembered, switching reloads the page). Not guessed from the browser: search engines render pages
  // in an English browser, and the page should read to them as the Chinese page it is.
  const LANGS = EVT.languages || ['zh'];
  const KEY_LANG = key('lang');
  const lang = (() => {
    let saved = null;
    try { saved = localStorage.getItem(KEY_LANG); } catch (e) { /* storage unavailable: Chinese */ }
    return LANGS.includes(saved) ? saved : 'zh';
  })();
  const DICT = lang === 'zh' ? null : (window.FP_I18N && window.FP_I18N[lang]) || null;
  // t('中文 {n}', { n }) → the UI string in the current language. Values are inserted as given (escape first for HTML).
  function t(zh, vars) {
    const s = (DICT && DICT[zh]) || zh;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
  }
  const listSep = lang === 'zh' ? '、' : ', ';
  const subtitle = (lang === 'en' && EVT.subtitleEn) || EVT.subtitle || '';
  const sourceNote = (lang === 'en' && EVT.sourceNoteEn) || EVT.sourceNote || '';
  const dur = (m) => m >= 60 ? (m % 60 ? t('{h} 小時 {m} 分', { h: Math.floor(m / 60), m: m % 60 }) : t('{h} 小時', { h: m / 60 })) : t('{n} 分', { n: m });
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasBigInt = typeof BigInt === 'function';
  const mmdd = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };

  const DAYS = {};
  const DAY_NUMS = [];
  EVT.days.forEach((d, i) => {
    const n = i + 1;
    const [y, m, dd] = d.date.split('-').map(Number);
    DAYS[n] = {
      label: d.label, date: `${m}/${dd}`, iso: d.date, start: toMin(d.start), end: toMin(d.end),
      dow: (lang === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : [...'日一二三四五六'])[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()],
    };
    DAY_NUMS.push(n);
  });
  const STAGES = EVT.stages.map((s) => {
    const name = lang === 'en' && s.en ? s.en : s.name;
    const short = lang === 'en' && s.en ? (s.shortEn || s.en) : (s.short || s.name);
    return { id: s.id, name, short, c: `var(--stage-${s.id})`, long: !!s.long || [...name].length > (lang === 'en' ? 10 : 6) };
  });
  const STAGE_AT = new Map(STAGES.map((s, i) => [s.id, i]));
  const ARTISTS = DATA.artists || {};

  // Board order: day, stage, start. Backup links don't depend on it — they use each show's permanent seq.
  const SHOWS = DATA.schedule.map((r) => ({
    id: r.id, seq: r.seq, day: r.day, stage: STAGES[STAGE_AT.get(r.stage)], si: STAGE_AT.get(r.stage),
    start: toMin(r.start), end: toMin(r.end), name: r.name, note: (lang === 'en' && r.noteEn) || r.note || '', noteZh: r.note || '', en: r.en || '', alias: r.alias || '',
    label: lang === 'en' && r.en ? r.en : r.name, // what the page shows; name stays the data key
  })).sort((a, b) => a.day - b.day || a.si - b.si || a.start - b.start);
  const BYID = new Map(SHOWS.map((s) => [s.id, s]));
  const overlap = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable: picks live for this visit only */ } },
  };

  // The festival's wall clock (EVT.timezone), whatever the phone's own time zone is.
  function festNow() {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: EVT.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      return { iso: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
    } catch (e) {
      return { iso: '', min: 0 };
    }
  }

  /* ---------- theme: follow the system unless the header icon picked light or dark ---------- */
  const tr = t;
  const themeMode = () => { const t = root.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : 'system'; };
  function setTheme(mode) {
    if (mode === 'light' || mode === 'dark') { root.setAttribute('data-theme', mode); store.set(KEY_THEME, mode); }
    else { root.removeAttribute('data-theme'); store.set(KEY_THEME, 'system'); }
  }
  const savedTheme = store.get(KEY_THEME);
  if (savedTheme === 'light' || savedTheme === 'dark') root.setAttribute('data-theme', savedTheme);
  // The header icon flips light ↔ dark from whatever is showing. Flipping to what the system shows anyway means
  // "follow the system" again, so a later system switch (e.g. dark at night) is followed with no tap.
  const themeBtn = $('themeBtn');
  const systemTheme = () => (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const effectiveTheme = () => { const t = themeMode(); return t === 'system' ? systemTheme() : t; };
  function syncThemeBtn() {
    const t = effectiveTheme();
    themeBtn.dataset.mode = t;
    themeBtn.setAttribute('aria-label', t === 'dark' ? tr('切換成淺色模式') : tr('切換成深色模式'));
  }
  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next === systemTheme() ? 'system' : next);
    syncThemeBtn();
  });
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncThemeBtn); } catch (e) { /* old Safari: the button still works */ }
  syncThemeBtn();

  /* ---------- picks: kept on this device ---------- */
  const picks = new Set();
  // When picks clash, the show you decide to go to. Every pick it overlaps becomes 備選 (kept, not removed).
  const prefs = new Set();
  let stamp = 0; // when these picks last changed (ms)
  try {
    const raw = JSON.parse(store.get(KEY_PICKS) || 'null');
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.picks) ? raw.picks : []);
    arr.forEach((id) => { if (BYID.has(id)) picks.add(id); });
    if (raw && Array.isArray(raw.prefs)) raw.prefs.forEach((id) => { if (picks.has(id)) prefs.add(id); });
    if (raw && typeof raw.t === 'number') stamp = raw.t;
  } catch (e) { /* unreadable copy: start empty */ }
  const savePicks = () => store.set(KEY_PICKS, JSON.stringify({ v: 1, picks: [...picks], prefs: [...prefs], t: stamp }));

  const state = { view: 'pick', day: DAY_NUMS[0] };
  try {
    const v = JSON.parse(store.get(KEY_VIEW) || '{}');
    if (v.view === 'mine' || v.view === 'pick') state.view = v.view;
    if (DAYS[v.day]) state.day = v.day;
  } catch (e) { /* unreadable view: defaults */ }
  const today = festNow();
  for (const n of DAY_NUMS) if (DAYS[n].iso === today.iso) state.day = n;
  const saveView = () => store.set(KEY_VIEW, JSON.stringify(state));

  function clusters(day) {
    const list = SHOWS.filter((s) => s.day === day && picks.has(s.id))
      .sort((a, b) => a.start - b.start || a.si - b.si);
    const out = [];
    let cur = null;
    let maxEnd = -1;
    for (const s of list) {
      if (cur && s.start < maxEnd) { cur.push(s); maxEnd = Math.max(maxEnd, s.end); }
      else { cur = [s]; out.push(cur); maxEnd = s.end; }
    }
    return out;
  }
  function isAlt(id) {
    if (!picks.has(id) || prefs.has(id)) return false;
    const s = BYID.get(id);
    for (const p of prefs) { if (overlap(s, BYID.get(p))) return true; }
    return false;
  }
  function choose(id) {
    const s = BYID.get(id);
    for (const p of [...prefs]) { if (p !== id && overlap(s, BYID.get(p))) prefs.delete(p); }
    prefs.add(id);
  }
  // A new pick that clashes with a decided show reopens that choice.
  function addPick(id) {
    picks.add(id);
    const s = BYID.get(id);
    for (const p of [...prefs]) { if (p !== id && overlap(s, BYID.get(p))) prefs.delete(p); }
  }
  function cleanPrefs() {
    for (const p of [...prefs]) if (!picks.has(p)) prefs.delete(p);
  }
  // going = picks you'll actually attend; clashing = going picks that still overlap each other.
  function clusterInfo(c) {
    const going = c.filter((s) => !isAlt(s.id));
    const alts = c.filter((s) => isAlt(s.id));
    const clashing = going.filter((s) => going.some((o) => o !== s && overlap(s, o)));
    return { going, alts, clashing };
  }
  const conflictCount = () => DAY_NUMS.reduce((n, d) => n + clusters(d).filter((c) => c.length > 1 && clusterInfo(c).clashing.length).length, 0);

  /* ---------- backup link (#p1-…): a bit per show, at the show's permanent seq ---------- */
  function encodePicks(set) {
    let n = 0n;
    SHOWS.forEach((s) => { if (set.has(s.id)) n |= 1n << BigInt(s.seq); });
    return 'p1-' + n.toString(36);
  }
  function decodeToken(tok) {
    const m = /^p1-([0-9a-z]+)$/.exec(tok || '');
    if (!m || !hasBigInt) return null;
    let n = 0n;
    for (const ch of m[1]) n = n * 36n + BigInt(parseInt(ch, 36));
    const out = new Set();
    SHOWS.forEach((s) => { if ((n >> BigInt(s.seq)) & 1n) out.add(s.id); });
    return out;
  }
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  // On the website the link points back to this page; inside a Claude artifact, to the artifact.
  const backupBase = () => EVT.mode === 'artifact' ? (EVT.urls.artifact || EVT.urls.site) : location.origin + location.pathname;

  /* ---------- board ---------- */
  const grid = $('grid');
  const board = $('board');
  const blockEls = new Map();
  let nowY = null;
  grid.style.setProperty('--ns', STAGES.length);

  function renderGrid() {
    const d = DAYS[state.day];
    grid.innerHTML = '';
    blockEls.clear();
    grid.style.setProperty('--H', (d.end - d.start) * PX + 'px');
    grid.style.setProperty('--hour', 60 * PX + 'px');

    grid.append(el('div', 'corner'));
    for (const st of STAGES) {
      const h = el('div', 'sh' + (st.long ? ' long' : ''));
      h.style.setProperty('--c', st.c);
      h.innerHTML = `<b>${esc(st.name)}</b>`;
      grid.append(h);
    }

    const times = el('div', 'times');
    for (let m = Math.ceil(d.start / 60) * 60; m <= d.end; m += 60) {
      const t = el('span', 'hl');
      const y = (m - d.start) * PX;
      t.textContent = String(m / 60);
      t.style.top = y + 'px';
      if (y === 0) t.classList.add('first');
      if (m === d.end) t.classList.add('last');
      times.append(t);
    }
    grid.append(times);

    for (const st of STAGES) {
      const col = el('div', 'col');
      col.style.setProperty('--c', st.c);
      for (const s of SHOWS) {
        if (s.day !== state.day || s.stage !== st) continue;
        const b = el('button', 'block');
        b.type = 'button';
        b.dataset.id = s.id;
        b.style.top = (s.start - d.start) * PX + 2 + 'px';
        b.style.height = (s.end - s.start) * PX - 4 + 'px';
        b.title = `${s.note ? s.note + '｜' : ''}${s.label}　${fmt(s.start)}–${fmt(s.end)}`;
        b.setAttribute('aria-label', t('{name}，{stage}，{start} 到 {end}', { name: s.label, stage: st.short, start: fmt(s.start), end: fmt(s.end) }));
        b.innerHTML =
          (s.note ? `<span class="nt">${esc(s.note)}</span>` : '') +
          `<span class="nm${s.label.length > 18 ? ' sm' : ''}">${esc(s.label)}</span>` +
          `<span class="tm">${fmt(s.start)}–${fmt(s.end)}</span>`;
        col.append(b);
        blockEls.set(s.id, b);
      }
      grid.append(col);
    }

    placeNowLine();
    refreshMarks();
    refreshBoardStatus();
    updateEdge();
    fitBlocks();
  }

  // Shrink a block's text step by step (fit1…fit4) until it fits — never cut it off. Runs after layout.
  function fitBlocks() {
    for (const b of blockEls.values()) {
      b.classList.remove('fit1', 'fit2', 'fit3', 'fit4', 'fit5', 'fit6');
      const fits = () => {
        const kids = [...b.children].filter((c) => !c.classList.contains('hit-tag') && !c.classList.contains('bprog'));
        const used = kids.reduce((n, c) => n + c.getBoundingClientRect().height, 0) + 2 * Math.max(0, kids.length - 1);
        return used <= b.clientHeight - 6 && kids.every((c) => c.scrollWidth <= c.clientWidth + 1);
      };
      for (let step = 1; step <= 6 && !fits(); step++) b.classList.add(`fit${step}`);
    }
  }
  try { document.fonts.ready.then(fitBlocks); } catch (e) { /* no font loading API: fitted after the first render */ }
  addEventListener('resize', () => requestAnimationFrame(fitBlocks));

  // Fade the board's right edge while more stages are off to the right.
  function updateEdge() {
    pickView.classList.toggle('more-right', board.scrollLeft + board.clientWidth < board.scrollWidth - 2);
  }
  board.addEventListener('scroll', updateEdge, { passive: true });
  addEventListener('resize', updateEdge);

  // Festival-day status on the board — ended shows fade, the playing ones get a progress bar.
  function refreshBoardStatus() {
    const now = festNow();
    for (const [id, b] of blockEls) {
      const s = BYID.get(id);
      const st = showStatus(s, now);
      b.classList.toggle('ended', st === 'ended');
      b.classList.toggle('playing', st === 'playing');
      let pb = b.querySelector('.bprog');
      if (st === 'playing') {
        if (!pb) { pb = el('span', 'bprog'); pb.setAttribute('aria-hidden', 'true'); pb.append(el('i')); b.append(pb); }
        pb.firstChild.style.width = Math.min(100, Math.max(0, ((now.min - s.start) / (s.end - s.start)) * 100)) + '%';
      } else if (pb) pb.remove();
    }
  }

  // Red "now" line: only on the festival day that's showing, within the board's hours.
  // Re-placed every minute and whenever the page comes back into view.
  function placeNowLine() {
    const d = DAYS[state.day];
    const now = festNow();
    const show = now.iso === d.iso && now.min >= d.start && now.min <= d.end;
    nowY = show ? (now.min - d.start) * PX : null;
    const lines = grid.querySelectorAll('.nowline');
    let tag = grid.querySelector('.nowtag');
    if (!show) {
      lines.forEach((l) => l.remove());
      if (tag) tag.remove();
      return;
    }
    if (!lines.length) {
      grid.querySelectorAll('.col').forEach((c) => c.append(el('div', 'nowline')));
    }
    if (!tag) {
      tag = el('span', 'nowtag');
      tag.textContent = t('現在');
      const times = grid.querySelector('.times');
      if (times) times.append(tag);
    }
    grid.querySelectorAll('.nowline').forEach((l) => { l.style.top = nowY + 'px'; });
    tag.style.top = nowY + 'px';
  }
  const tick = () => { placeNowLine(); refreshBoardStatus(); refreshStatus(); renderNext(); };
  setInterval(tick, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  function refreshMarks() {
    const going = [...picks].filter((id) => !isAlt(id)).map((id) => BYID.get(id));
    for (const [id, b] of blockEls) {
      const s = BYID.get(id);
      const on = picks.has(id);
      const alt = on && isAlt(id);
      let touches = false;
      for (const p of going) { if (p.id !== id && overlap(s, p)) { touches = true; break; } }
      b.classList.toggle('sel', on && !alt);
      b.classList.toggle('alt', alt);
      b.classList.toggle('clash', !on && touches);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const label = alt ? t('備選') : on && touches ? t('撞') : '';
      let tag = b.querySelector('.hit-tag');
      if (label) {
        if (!tag) { tag = el('span', 'hit-tag'); tag.setAttribute('aria-hidden', 'true'); b.append(tag); }
        tag.textContent = label;
        tag.classList.toggle('alt-tag', alt);
      } else if (tag) tag.remove();
    }
  }

  function scrollBoard() {
    board.scrollLeft = 0;
    board.scrollTop = nowY != null ? Math.max(0, nowY - 140) : 0;
  }

  board.addEventListener('click', (e) => {
    const b = e.target.closest('.block');
    if (!b) return;
    if (consumePress()) return; // the release of a long press is not a tap
    const id = b.dataset.id;
    if (picks.has(id)) picks.delete(id);
    else addPick(id);
    commit();
  });

  /* ---------- where the picks are kept (cloud.js may take this over) ---------- */
  const sync = {
    state: 'local',
    text: EVT.mode === 'artifact'
      ? t('團序存在這個瀏覽器裡，換裝置或清除瀏覽資料就會不見。建議複製一份備份連結存著。')
      : t('團序存在這台裝置裡，換手機或清除瀏覽資料就會不見。建議複製一份備份連結存著。'),
  };
  function setSync(s, text) {
    sync.state = s;
    if (text) sync.text = text;
    const n = $('syncNote');
    if (n) { n.dataset.state = s; n.textContent = sync.text; }
  }

  // Replace the picks with a newer copy (from the account or a backup link) without stamping a new time.
  function adopt(list, t, prefList) {
    picks.clear();
    list.forEach((id) => { if (BYID.has(id)) picks.add(id); });
    prefs.clear();
    (Array.isArray(prefList) ? prefList : []).forEach((id) => { if (picks.has(id)) prefs.add(id); });
    stamp = t;
    savePicks();
    refreshMarks();
    updateCounts();
    renderNext();
    if (state.view === 'mine') renderMine();
  }

  /* ---------- my schedule ---------- */
  const mineIn = $('mineIn');

  function itemHTML(s, opt = {}) {
    const extra = opt.choosable
      ? `<button type="button" class="choose" data-choose="${s.id}">${t('去這團')}</button>`
      : opt.chosen ? `<span class="go-tag">${t('要去')}</span>` : '';
    return `<article class="item${opt.choosable ? ' choosable' : ''}" data-id="${s.id}"${opt.choosable ? ` data-choose="${s.id}"` : ''} style="--c:${s.stage.c}">
      <div class="it"><b>${fmt(s.start)}</b><span>${fmt(s.end)}</span></div>
      <div class="im">
        <div class="imeta"><span class="pill">${esc(s.stage.short)}</span><span class="dur">${t('{n} 分', { n: s.end - s.start })}</span>${extra}</div>
        <h3>${esc(s.label)}</h3>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
      </div>
    </article>`;
  }

  function altHTML(s) {
    return `<div class="alt-row" data-id="${s.id}" style="--c:${s.stage.c}">
      <button type="button" class="alt-main" data-choose="${s.id}" aria-label="${esc(t('改去 {name}', { name: s.label }))}">
        <span class="alt-label">${t('備選')}</span>
        <span class="alt-time">${fmt(s.start)}–${fmt(s.end)}</span>
        <span class="alt-name">${esc(s.label)}</span>
        <span class="alt-act">${t('改去這團')}</span>
      </button>
    </div>`;
  }

  function gapHTML(gap) {
    if (gap <= 0) return `<div class="gap tight">${t('無縫接下一團')}</div>`;
    if (gap <= 10) return `<div class="gap tight">${t('{n} 分鐘換場，提早移動', { n: gap })}</div>`;
    return `<div class="gap">${t('空檔 {d}', { d: dur(gap) })}</div>`;
  }

  function renderMine() {
    const out = [];
    const perDay = DAY_NUMS.map((n) => `${DAYS[n].label} ${[...picks].filter((id) => BYID.get(id).day === n).length}`).join('・');
    const k = conflictCount();
    out.push(`<div class="mine-head"><div class="mine-sum"><b>${t('我的團序')}</b><span>${t('已選 {n} 團（{days}）', { n: picks.size, days: perDay })}${k ? ` · <button type="button" class="warn">${t('{n} 處撞團', { n: k })}</button>` : ''}</span><span>${esc(subtitle)}</span></div></div>`);
    for (const day of DAY_NUMS) {
      const d = DAYS[day];
      const cl = clusters(day);
      const n = cl.reduce((a, c) => a + c.length, 0);
      out.push(`<section class="mday" id="mday${day}"><h2><span class="dl">${d.label}</span><span class="dd">${lang === 'en' ? `${d.dow} ${d.date}` : `${d.date}（${d.dow}）`}</span><span class="dn">${t('{n} 團', { n })}</span></h2>`);
      if (!n) out.push(`<p class="empty">${t('這天還沒選。點下方的「{day}」，在時間表上點表演就會加進來。', { day: d.label })}</p>`);
      let prevEnd = null;
      for (const c of cl) {
        const info = clusterInfo(c);
        const span = info.going.length ? info.going : c;
        if (prevEnd !== null) out.push(gapHTML(Math.min(...span.map((s) => s.start)) - prevEnd));
        if (c.length > 1) {
          const open = info.clashing.length > 0;
          const head = open
            ? `<div class="ch"><span><b>${t('撞團')}</b>${t('點一團要去的，其他會變成備選')}</span><button type="button" class="draw" data-ids="${info.clashing.map((s) => s.id).join(',')}">${t('抽籤')}</button></div>`
            : `<div class="ch done"><span><b>${t('已決定')}</b>${t('撞團 {all} 選 {going}', { all: c.length, going: info.going.length })}</span><button type="button" class="redo" data-ids="${c.map((s) => s.id).join(',')}">${t('重新選擇')}</button></div>`;
          const cards = info.going.map((s) => itemHTML(s, { choosable: info.clashing.includes(s), chosen: prefs.has(s.id) })).join('');
          out.push(`<div class="cluster${open ? '' : ' done'}">${head}${cards}${info.alts.map(altHTML).join('')}</div>`);
        } else {
          out.push(itemHTML(c[0]));
        }
        prevEnd = Math.max(...span.map((s) => s.end));
      }
      out.push('</section>');
    }
    const actions = [];
    if (picks.size && hasBigInt) actions.push(`<button type="button" class="pill-btn" id="backupBtn">${t('複製備份連結')}</button>`);
    if (hasBigInt) actions.push(`<button type="button" class="pill-btn quiet" id="importBtn">${t('從備份連結還原')}</button>`);
    if (picks.size) actions.push(`<button type="button" class="pill-btn quiet" id="clearBtn">${t('清除全部')}</button>`);
    out.push(`<div class="keep"><p class="sync" id="syncNote" data-state="${sync.state}">${esc(sync.text)}</p>${actions.length ? `<div class="keep-actions">${actions.join('')}</div>` : ''}</div>`);
    out.push(`<p class="src">${esc(sourceNote)}</p>`);
    out.push(`<p class="src src-links"><button type="button" class="about-link" id="aboutBtn">${t('關於・自己做一個')}</button>${EVT.about ? `<button type="button" class="about-link" id="privacyBtn">${t('隱私說明')}</button>` : ''}</p>`);
    mineIn.innerHTML = out.join('');
    refreshStatus();
  }

  // Festival-day status in 我的團序: 演出中 (with progress) and 已結束 (faded). Festival time.
  function showStatus(s, now) {
    const iso = DAYS[s.day].iso;
    if (!now.iso || now.iso < iso) return '';
    if (now.iso > iso || now.min >= s.end) return 'ended';
    return now.min >= s.start ? 'playing' : '';
  }
  function refreshStatus() {
    if (mineView.hidden) return;
    const now = festNow();
    mineIn.querySelectorAll('.item[data-id]').forEach((it) => {
      const s = BYID.get(it.dataset.id);
      const st = showStatus(s, now);
      it.classList.toggle('playing', st === 'playing');
      it.classList.toggle('ended', st === 'ended');
      let tag = it.querySelector('.st');
      if (st) {
        if (!tag) { tag = el('span', 'st'); it.querySelector('.imeta').append(tag); }
        tag.className = 'st ' + (st === 'playing' ? 'live' : 'done');
        tag.textContent = st === 'playing' ? t('演出中') : t('已結束');
      } else if (tag) tag.remove();
      let bar = it.querySelector('.prog');
      if (st === 'playing') {
        if (!bar) { bar = el('div', 'prog'); bar.setAttribute('aria-hidden', 'true'); bar.append(el('i')); it.append(bar); }
        const pct = Math.min(100, Math.max(0, ((now.min - s.start) / (s.end - s.start)) * 100));
        bar.firstChild.style.width = pct + '%';
      } else if (bar) bar.remove();
    });
  }

  let clearTimer = null;
  mineIn.addEventListener('click', (e) => {
    if (consumePress()) return;
    if (e.target.closest('.warn')) {
      const first = mineIn.querySelector('.cluster');
      if (first) first.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      return;
    }

    const dr = e.target.closest('.draw');
    if (dr) { openLottery(dr.dataset.ids.split(','), dr); return; }
    const rd = e.target.closest('.redo');
    if (rd) {
      rd.dataset.ids.split(',').forEach((id) => prefs.delete(id));
      commit();
      toast(t('已重新打開，點一團要去的'));
      return;
    }
    const plain = e.target.closest('.item[data-id]:not([data-choose])');
    if (plain) { openArtist(plain.dataset.id, plain, false); return; }
    const ch = e.target.closest('[data-choose]');
    if (ch) {
      const s = BYID.get(ch.dataset.choose);
      choose(s.id);
      commit();
      toast(t('要去 {name}，撞到的改成備選', { name: s.label }));
      return;
    }
    const bk = e.target.closest('#backupBtn');
    if (bk) {
      copyText(`${backupBase()}#${encodePicks(picks)}`, bk, t('已複製備份連結，貼到備忘錄存著'), t('複製備份連結'), t('打開這個連結就能還原目前的團序。'));
      return;
    }
    const im = e.target.closest('#importBtn');
    if (im) { openImportSheet(im); return; }
    const ab = e.target.closest('#aboutBtn');
    if (ab) { openAboutSheet(ab); return; }
    const pv = e.target.closest('#privacyBtn');
    if (pv) { openPrivacySheet(pv); return; }
    const cb = e.target.closest('#clearBtn');
    if (cb) {
      if (cb.classList.contains('armed')) {
        clearTimeout(clearTimer);
        picks.clear();
        commit();
        toast(t('已清除全部'));
      } else {
        cb.classList.add('armed');
        cb.textContent = t('再按一次確認清除');
        clearTimer = setTimeout(() => { cb.classList.remove('armed'); cb.textContent = t('清除全部'); }, 3000);
      }
    }
  });

  /* ---------- views & counts ---------- */
  const pickView = $('pickView');
  const mineView = $('mineView');
  const dayBtns = DAY_NUMS.map((n) => $('day' + n));

  // The dock's tabs: one per festival day (that day's board) and 我的團序.
  function markTabs() {
    dayBtns.forEach((b, i) => b.setAttribute('aria-pressed', state.view === 'pick' && DAY_NUMS[i] === state.day ? 'true' : 'false'));
    $('tabMine').setAttribute('aria-pressed', state.view === 'mine' ? 'true' : 'false');
  }

  function setView(v) {
    state.view = v;
    document.querySelector('.app').dataset.view = v;
    pickView.hidden = v !== 'pick';
    mineView.hidden = v !== 'mine';
    markTabs();
    if (v === 'pick') updateEdge();
    if (v === 'mine') renderMine();
    saveView();
  }

  function setDay(n) {
    const changed = state.day !== n || state.view !== 'pick';
    state.day = n;
    if (state.view !== 'pick') setView('pick');
    markTabs();
    if (changed) { renderGrid(); scrollBoard(); }
    saveView();
  }

  // Count and clashes are the 我的團序 tab's second line: plain text that always fits, never a floating badge.
  function updateCounts() {
    const k = conflictCount();
    $('mineSub').innerHTML = `${t('{n} 團', { n: picks.size })}${k ? ` · <span class="clash">${t('撞 {n}', { n: k })}</span>` : ''}`;
    $('tabMine').setAttribute('aria-label', t('我的團序，已選 {n} 團', { n: picks.size }) + (k ? t('，{n} 處撞團', { n: k }) : ''));
  }

  const commitHooks = [];
  function commit(t) {
    stamp = typeof t === 'number' ? t : Date.now();
    cleanPrefs();
    savePicks();
    refreshMarks();
    updateCounts();
    renderNext();
    if (!lpCard.hidden && lpShowId) renderLpAct();
    if (state.view === 'mine') renderMine();
    commitHooks.forEach((fn) => { try { fn(); } catch (e) { console.error('[fp] commit hook failed', e); } });
  }

  $('tabMine').addEventListener('click', () => setView('mine'));
  dayBtns.forEach((b, i) => b.addEventListener('click', () => setDay(DAY_NUMS[i])));

  // Scroll to a show and outline it briefly. Used by search and the next-up bar.
  function flash(node) {
    node.classList.remove('located');
    void node.offsetWidth;
    node.classList.add('located');
    setTimeout(() => node.classList.remove('located'), 1700);
  }
  function locateShow(id) {
    const s = BYID.get(id);
    if (!s) return;
    if (state.view === 'mine') {
      const it = mineIn.querySelector(`[data-id="${id}"]`);
      if (it) {
        it.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        flash(it);
        return;
      }
      setView('pick');
    }
    if (state.day !== s.day) setDay(s.day);
    const b = blockEls.get(id);
    if (!b) return;
    const br = board.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const rail = (grid.querySelector('.times') || { offsetWidth: 48 }).offsetWidth;
    board.scrollBy({
      top: r.top - br.top - (br.height - r.height) / 2,
      left: r.left - br.left - rail - 12,
      behavior: reduceMotion() ? 'auto' : 'smooth',
    });
    flash(b);
  }

  // On festival days, what's playing now and what's next among the shows you're going to.
  const nextBar = $('nextBar');
  function renderNext() {
    const now = festNow();
    const day = DAY_NUMS.find((n) => DAYS[n].iso === now.iso);
    if (!day) { nextBar.hidden = true; nextBar.innerHTML = ''; return; }
    const list = SHOWS.filter((s) => s.day === day && picks.has(s.id) && !isAlt(s.id)).sort((a, b) => a.start - b.start || a.si - b.si);
    const live = list.filter((s) => now.min >= s.start && now.min < s.end);
    const next = list.find((s) => s.start > now.min);
    if (!live.length && !next) { nextBar.hidden = true; nextBar.innerHTML = ''; return; }
    const rows = [];
    if (live.length) {
      const s = live[0];
      const pct = ((now.min - s.start) / (s.end - s.start)) * 100;
      rows.push(`<button type="button" class="nx live" data-go="${s.id}" style="--c:${s.stage.c}">
        <span class="nx-lb">${t('演出中')}</span><span class="pill">${esc(s.stage.short)}</span><span class="nx-name">${esc(s.label)}</span>
        ${live.length > 1 ? `<span class="nx-more">${t('+{n} 撞', { n: live.length - 1 })}</span>` : ''}
        <span class="nx-left">${t('剩 {n} 分', { n: s.end - now.min })}</span>
        <span class="nx-prog" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></span></button>`);
    }
    if (next) {
      const left = next.start - now.min;
      const liveEnd = live.length ? Math.max(...live.map((s) => s.end)) : null;
      const tight = left <= 10 || (liveEnd !== null && next.start - liveEnd <= 10);
      const nextClash = list.filter((o) => o !== next && o.start > now.min && overlap(o, next)).length;
      rows.push(`<button type="button" class="nx${tight ? ' tight' : ''}" data-go="${next.id}" style="--c:${next.stage.c}">
        <span class="nx-lb">${t('下一團')}</span><span class="pill">${esc(next.stage.short)}</span>
        <span class="nx-stack"><span class="nx-name">${esc(next.label)}</span>
        <span class="nx-sub"><span class="nx-t">${t('{time} · 還有 {d}', { time: fmt(next.start), d: dur(left) })}</span>${nextClash ? `<span class="nx-warn">${t('撞 {n} 團還沒決定', { n: nextClash })}</span>` : ''}</span></span></button>`);
    }
    nextBar.innerHTML = rows.join('');
    nextBar.hidden = false;
  }
  nextBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) locateShow(b.dataset.go);
  });

  // Search by Chinese or English name, plus a "名字相近" row for near misses like ano / ana.
  const norm = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\s·・.,_'’"“”()（）×&!?！？:：、\-–]/g, '');
  let INDEX = null; // built on first search, after every helper it needs exists
  function getIndex() {
    if (!INDEX) {
      INDEX = SHOWS.map((s) => {
        const parts = [s.name, s.en, s.note, s.noteZh, s.alias, ...splitArtists(s.name)];
        return { s, hay: norm(parts.join(' ')), main: norm(s.name), en: norm(s.en) };
      });
    }
    return INDEX;
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }
  function mark(text, q) {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  function spItem(s, raw) {
    const d = DAYS[s.day];
    const tag = !picks.has(s.id) ? '' : isAlt(s.id) ? `<span class="sp-tag">${t('備選')}</span>` : `<span class="sp-tag on">${t('已選')}</span>`;
    const en = s.en && !s.name.toLowerCase().includes(s.en.toLowerCase()) ? `<span class="sp-en">${mark(s.en, raw)}</span>` : '';
    return `<button type="button" class="sp-item" data-loc="${s.id}" style="--c:${s.stage.c}">
      <i></i><span class="sp-nm">${mark(s.name, raw)}${en}</span>
      <span class="sp-meta">${d.label} · <span class="mono">${fmt(s.start)}</span> · ${esc(s.stage.short)}${tag}</span></button>`;
  }
  const spRes = $('spRes');
  const spInput = $('spInput');
  let spFirst = null;
  function runSearch() {
    const raw = spInput.value.trim();
    const q = norm(raw);
    spFirst = null;
    if (!q) { spRes.innerHTML = ''; return; } // the placeholder already says what to type
    const hits = getIndex().filter((x) => x.hay.includes(q))
      .map((x) => ({ x, rank: x.main.startsWith(q) || x.en.startsWith(q) ? 0 : x.main.includes(q) || x.en.includes(q) ? 1 : 2 }))
      .sort((a, b) => a.rank - b.rank || a.x.s.day - b.x.s.day || a.x.s.start - b.x.s.start);
    const seen = new Set(hits.map((h) => h.x.s.id));
    const near = q.length >= 3 && /^[a-z0-9]+$/.test(q)
      ? getIndex().filter((x) => !seen.has(x.s.id) && [x.main, x.en].some((n) => n && n.length <= 8 && lev(q, n) === 1))
      : [];
    const out = hits.slice(0, 12).map((h) => spItem(h.x.s, raw));
    if (near.length) out.push(`<p class="sp-sec">${t('名字相近')}</p>`, ...near.slice(0, 4).map((x) => spItem(x.s, '')));
    if (!out.length) out.push(`<p class="sp-hint">${t('找不到「{q}」。試試別的寫法，或用英文名。', { q: esc(raw) })}</p>`);
    spRes.innerHTML = out.join('');
    spFirst = (hits[0] && hits[0].x.s.id) || (near[0] && near[0].s.id) || null;
  }
  const sp = $('sp');
  const spScrim = $('spScrim');
  // The search field sits at the bottom: keep it above the on-screen keyboard.
  const vv = window.visualViewport;
  function updateKeyboard() {
    const kb = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--kb', `${Math.round(kb)}px`);
  }
  if (vv) { vv.addEventListener('resize', updateKeyboard); vv.addEventListener('scroll', updateKeyboard); }
  function openSearch() {
    sp.hidden = false;
    spScrim.hidden = false;
    spInput.value = '';
    runSearch();
    spInput.focus();
  }
  function closeSearch() {
    if (sp.hidden) return;
    sp.hidden = true;
    spScrim.hidden = true;
    spInput.blur();
  }
  $('searchBtn').addEventListener('click', openSearch);
  $('spClose').addEventListener('click', () => { closeSearch(); $('searchBtn').focus(); });
  spScrim.addEventListener('click', closeSearch);
  spInput.addEventListener('input', runSearch);
  spInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && spFirst) { e.preventDefault(); const id = spFirst; closeSearch(); locateShow(id); }
  });
  spRes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-loc]');
    if (!b) return;
    closeSearch();
    locateShow(b.dataset.loc);
  });

  /* ---------- sheet ---------- */
  const sheet = $('sheet');
  const scrim = $('scrim');
  let lastFocus = null;
  let lot = null;
  let pendingLink = null;
  let spinTimer = null;

  function openSheet(opener) {
    lastFocus = opener || document.activeElement;
    scrim.hidden = false;
    sheet.hidden = false;
    // Focus moves into the sheet without scrolling it: a long sheet (關於) opens at its title, not at its 完成 button.
    const f = sheet.querySelector('.primary') || sheet.querySelector('button');
    if (f) f.focus({ preventScroll: true });
    sheet.scrollTop = 0;
  }
  function closeSheet() {
    endOnboard(); // closing the walkthrough any way (button, outside, Esc) counts as seen
    clearTimeout(spinTimer);
    lot = null;
    pendingLink = null;
    sheet.hidden = true;
    scrim.hidden = true;
    sheet.innerHTML = '';
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  scrim.addEventListener('click', closeSheet);
  // Pull a sheet down to close it, as on iPhone: from its grab bar, or anywhere while it is scrolled to the top.
  // (Not the walkthrough card, and not while typing.)
  let pull = null;
  sheet.addEventListener('touchstart', (e) => {
    if (ob || e.touches.length !== 1 || e.target.closest('textarea, input, iframe')) return;
    if (sheet.scrollTop > 0 && !e.target.closest('.grab')) return;
    pull = { y: e.touches[0].clientY, dy: 0 };
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!pull) return;
    pull.dy = Math.max(0, e.touches[0].clientY - pull.y);
    if (!pull.dy) return;
    if (e.cancelable) e.preventDefault(); // the sheet follows the finger instead of the page bouncing
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${pull.dy}px)`;
  }, { passive: false });
  const endPull = () => {
    if (!pull) return;
    const far = pull.dy > 90;
    pull = null;
    sheet.style.transition = 'transform .18s ease-out';
    sheet.style.transform = far ? 'translateY(100%)' : '';
    setTimeout(() => { sheet.style.transition = ''; sheet.style.transform = ''; if (far) closeSheet(); }, far ? 170 : 200);
  };
  sheet.addEventListener('touchend', endPull);
  sheet.addEventListener('touchcancel', endPull);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('sp').hidden) closeSearch();
    else if (!$('lpCard').hidden) closeArtist();
    else if (!sheet.hidden) closeSheet();
  });

  function openLottery(ids, opener) {
    lot = { ids, win: null, spinning: false };
    const cands = ids.map((id) => BYID.get(id));
    sheet.innerHTML = `<div class="grab"></div>
      <h2 id="sheetTitle">${t('撞團抽籤')}</h2>
      <p class="sub">${t('{n} 團撞在一起，交給運氣決定', { n: cands.length })}</p>
      <div class="cands">${cands.map((s, i) => `<div class="cand" data-i="${i}" style="--c:${s.stage.c}"><span class="pill">${esc(s.stage.short)}</span><span class="cn">${esc(s.label)}</span><span class="ct">${fmt(s.start)}–${fmt(s.end)}</span></div>`).join('')}</div>
      <div class="lot-result" id="lotResult" hidden></div>
      <div class="sheet-actions" id="lotActions">
        <button type="button" class="ghost" data-act="close">${t('取消')}</button>
        <button type="button" class="primary" data-act="spin">${t('抽！')}</button>
      </div>`;
    openSheet(opener);
  }

  function spin() {
    if (!lot || lot.spinning) return;
    if (lot.rigged) { scold(); return; } // the favourite already won: no second draw
    lot.spinning = true;
    lot.win = null;
    const cands = [...sheet.querySelectorAll('.cand')];
    cands.forEach((c) => c.classList.remove('on', 'win', 'lose'));
    $('lotResult').hidden = true;
    $('lotActions').innerHTML = `<button type="button" class="ghost" data-act="close">${t('取消')}</button><button type="button" class="primary" disabled>${t('抽籤中…')}</button>`;
    const n = cands.length;
    // event.json "lottery.favorite": that show always wins the draw (it's a joke the organisers' fans get).
    const fav = EVT.lottery && EVT.lottery.favorite ? lot.ids.findIndex((id) => BYID.get(id).name === EVT.lottery.favorite) : -1;
    const w = fav >= 0 ? fav : Math.floor(Math.random() * n);
    lot.rigged = fav >= 0;
    const total = reduceMotion() ? 0 : n * 4 + w;
    let i = reduceMotion() ? w : 0;
    const step = () => {
      cands.forEach((c, j) => c.classList.toggle('on', j === i % n));
      if (i >= total) { finish(w); return; }
      const t = i / total;
      i += 1;
      spinTimer = setTimeout(step, 50 + Math.pow(t, 3) * 360);
    };
    step();
  }

  function finish(w) {
    if (!lot) return;
    lot.spinning = false;
    lot.win = lot.ids[w];
    const s = BYID.get(lot.win);
    sheet.querySelectorAll('.cand').forEach((c, j) => {
      c.classList.remove('on');
      c.classList.add(j === w ? 'win' : 'lose');
    });
    const r = $('lotResult');
    const L = EVT.lottery || {};
    const caption = lot.rigged ? (lang === 'en' && L.captionEn) || L.caption : '';
    r.innerHTML = `<span>${esc(caption || t('就決定是你了'))}</span><b>${esc(s.label)}</b><small>${esc(s.stage.short)} · ${fmt(s.start)}–${fmt(s.end)}</small>`
      + (lot.rigged && L.emoji && !reduceMotion() ? `<div class="lot-burst" aria-hidden="true">${Array.from({ length: 12 }, (_, k) => `<i style="--a:${k * 30}deg">${esc(L.emoji)}</i>`).join('')}</div>` : '');
    r.hidden = false;
    $('lotActions').innerHTML = `<button type="button" class="ghost" data-act="spin">${t('再抽一次')}</button><button type="button" class="primary" data-act="accept">${t('就去這團')}</button>`;
    sheet.querySelector('.primary').focus({ preventScroll: true });
  }

  // Drawing again after the favourite won: a telling-off, and only "accept" left.
  function scold() {
    const L = EVT.lottery || {};
    const r = $('lotResult');
    if (!r.querySelector('.lot-scold')) r.insertAdjacentHTML('beforeend', `<div class="lot-scold">${esc((lang === 'en' && L.scoldEn) || L.scold || '')}</div>`);
    $('lotActions').innerHTML = `<button type="button" class="primary" data-act="accept">${t('接受結果')}</button>`;
    sheet.querySelector('.primary').focus({ preventScroll: true });
  }

  function accept() {
    if (!lot || !lot.win) return;
    const w = BYID.get(lot.win);
    choose(w.id);
    closeSheet();
    commit();
    toast(t('就決定去 {name}，撞到的改成備選', { name: w.label }));
  }

  function openLinkSheet(set) {
    pendingLink = set;
    const perDay = DAY_NUMS.map((n) => t('{day} {n} 團', { day: DAYS[n].label, n: [...set].filter((id) => BYID.get(id).day === n).length })).join(listSep);
    sheet.innerHTML = `<div class="grab"></div>
      <h2 id="sheetTitle">${t('連結裡有一份團序')}</h2>
      <p class="sub">${t('連結帶了 {n} 團（{days}），你目前選了 {mine} 團。要換成連結裡的嗎？', { n: set.size, days: perDay, mine: picks.size })}</p>
      <div class="sheet-actions">
        <button type="button" class="ghost" data-act="close">${t('保留目前的')}</button>
        <button type="button" class="primary" data-act="use-link">${t('換成連結的')}</button>
      </div>`;
    openSheet();
  }

  // Paste a backup link — also how picks move from Safari into the home-screen app, or from the artifact to the website.
  function openImportSheet(opener) {
    sheet.innerHTML = `<div class="grab"></div>
      <h2 id="sheetTitle">${t('從備份連結還原')}</h2>
      <p class="sub">${t('把之前複製的備份連結貼在下面。網站和 Claude artifact 版的連結都可以。')}</p>
      <textarea id="importText" rows="3" placeholder="https://…#p1-…" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
      <p class="sheet-err" id="importErr" hidden></p>
      <div class="sheet-actions">
        <button type="button" class="ghost" data-act="close">${t('取消')}</button>
        <button type="button" class="primary" data-act="import">${t('還原')}</button>
      </div>`;
    openSheet(opener);
    $('importText').focus();
  }
  function runImport() {
    const m = /(?:^|[#\s])(p1-[0-9a-z]+)/.exec(($('importText').value || '').trim());
    const set = m ? decodeToken(m[1]) : null;
    const errEl = $('importErr');
    if (!set || !set.size) {
      errEl.textContent = t('讀不到團序。請貼整段備份連結，結尾會是「#p1-」加一串英數字。');
      errEl.hidden = false;
      return;
    }
    closeSheet();
    if (sameSet(set, picks)) { toast(t('跟目前的團序一樣，不用還原')); return; }
    if (!picks.size) {
      set.forEach((id) => picks.add(id));
      commit();
      toast(t('已從連結還原 {n} 團', { n: set.size }));
    } else {
      openLinkSheet(set);
    }
  }

  function openAboutSheet(opener) {
    const repo = EVT.urls.repo;
    const ev = `events/${EVT.slug}`;
    const links = repo ? [
      [`${repo}/tree/main/${ev}`, t('原始碼'), t('這個活動的資料與設定')],
      [`${repo}/blob/main/${ev}/CLAUDE.md`, 'CLAUDE.md', t('交給 Claude 照做的步驟與資料規則')],
      [`${repo}/blob/main/${ev}/artifact/index.html`, t('原始 artifact'), t('單一 HTML，貼給 Claude 發成你自己的')],
    ] : [];
    sheet.innerHTML = `<div class="grab"></div>
      <h2 id="sheetTitle">${t('關於・自己做一個')}</h2>
      <p class="sub">${esc(t('{name} 排團工具。', { name: lang === 'en' && EVT.nameEn ? EVT.nameEn : EVT.name }))}${esc(sourceNote)}</p>
      ${links.length ? `<p class="about-p">${t('程式和資料都公開在 GitHub。照著活動資料夾裡的 CLAUDE.md，就能做出你自己的音樂祭版本。')}</p>
      <div class="about-links">${links.map(([href, label, sub]) => `<a href="${esc(href)}" target="_blank" rel="noopener"><b>${esc(label)}</b><span>${esc(sub)}</span></a>`).join('')}</div>` : ''}
      ${EVT.about ? `<p class="about-h">${t('特色')}</p>
      <ul class="about-feats">${EVT.about.features.map((f) => `<li><b>${esc(t(f.title))}</b><span>${esc(t(f.text))}</span></li>`).join('')}</ul>
      <p class="about-h">${t('常見問題')}</p>
      <div class="about-faq">${EVT.about.faq.map((x) => `<h3>${esc(t(x.q))}</h3><p>${esc(t(x.a))}</p>`).join('')}<button type="button" class="about-faq-link" data-act="privacy">${t('隱私說明')}</button></div>` : ''}
      <p class="about-meta" id="aboutMeta">${t('版本 {build}・時間表資料 {date}', { build: esc(EVT.build), date: mmdd(EVT.dataDate) })}</p>
      <div class="sheet-actions"><button type="button" class="primary" data-act="close">${t('完成')}</button></div>`;
    openSheet(opener);
  }

  // 隱私說明 inside the app, like 關於: the privacy page's text (built in, so it opens offline too). In English, only
  // its English summary. Links go out in a new tab, so the planner stays where it was.
  function openPrivacySheet(opener) {
    const box = el('div', 'pv');
    box.innerHTML = EVT.about.privacyHtml;
    if (lang === 'en') {
      const en = box.querySelector('section.en');
      box.innerHTML = '';
      if (en) { en.querySelector('h2')?.remove(); box.append(en); }
    }
    box.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    sheet.innerHTML = `<div class="grab"></div>
      <h2 id="sheetTitle">${t('隱私說明')}</h2>
      ${box.outerHTML}
      <div class="sheet-actions"><button type="button" class="primary" data-act="close">${t('完成')}</button></div>`;
    openSheet(opener);
  }

  // Screen and viewport numbers, for checking layouts on a real phone: tap the version line 5 times.
  let metaTaps = 0;
  function diagnostics() {
    const probe = el('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const vv = window.visualViewport;
    const lines = [
      `build ${EVT.build}`,
      `screen ${screen.width}×${screen.height} @${devicePixelRatio}`,
      `inner ${innerWidth}×${innerHeight}`,
      `client ${root.clientWidth}×${root.clientHeight}`,
      `visual ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} +${Math.round(vv.offsetTop)}` : '-'}`,
      `safe-area t${cs.paddingTop} r${cs.paddingRight} b${cs.paddingBottom} l${cs.paddingLeft}`,
      `app ${Math.round(document.querySelector('.app').getBoundingClientRect().height)} dock ${Math.round($('dock').getBoundingClientRect().bottom)}`,
      `standalone ${navigator.standalone === true || matchMedia('(display-mode: standalone)').matches} theme ${themeMode()}`,
      navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''),
    ];
    probe.remove();
    return lines.join('\n');
  }

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('#aboutMeta') && ++metaTaps >= 5) {
      metaTaps = 0;
      const m = $('aboutMeta');
      m.style.whiteSpace = 'pre-wrap';
      m.style.textAlign = 'left';
      m.textContent = diagnostics();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'close') closeSheet();
    else if (act === 'spin') spin();
    else if (act === 'accept') accept();
    else if (act === 'import') runImport();
    else if (act === 'ob-next' && ob) showStep(ob.i + 1);
    else if (act === 'ob-back' && ob) showStep(ob.i - 1);
    else if (act === 'ob-skip') closeSheet();
    else if (act === 'ob-done') closeSheet();
    else if (act === 'privacy') openPrivacySheet();
    else if (act.startsWith('ob-') && ob && ob.steps[ob.i].act) ob.steps[ob.i].act(act, b);
    else if (act === 'use-link' && pendingLink) {
      const set = pendingLink;
      closeSheet();
      picks.clear();
      set.forEach((id) => picks.add(id));
      commit();
      toast(t('已換成連結裡的 {n} 團', { n: set.size }));
    }
  });

  /* ---------- first visit: the walkthrough (the cards of 大港撞團) ---------- */
  // A centred card, one step at a time: long-press for the artist card, 我的團序 and the map, then (website only,
  // from pwa.js) adding it to the home screen. People who already used the
  // app — picks, or the old one-line hint dismissed — get only the add-on steps that are due (the home-screen step: up
  // to three times a day on a phone). 跳過 closes it;
  // closing it any way counts as seen, and a step counts once it was on screen.
  const KEY_ONBOARD = key('onboard');
  const obAddOns = []; // { id, icon, keep, title(), body(), cta?() → { act, label }, act?(name, button), due?(), seen?() }
  let ob = null; // { steps, i, shown }

  // The example artist card: event.json "onboardExample" (a show id), else the first set with players.
  function exampleShow() {
    return BYID.get(EVT.onboardExample) || SHOWS.find((s) => ARTISTS[s.name]?.embeds) || SHOWS[0];
  }
  const OB_PRESS = {
    id: 'press',
    icon: '👆',
    title: () => t('長按看表演者資訊'),
    body: () => {
      const s = exampleShow();
      const E = window.FP_EMBED;
      const embeds = ARTISTS[s.name]?.embeds || {};
      const plats = E ? [...new Set(E.platforms.filter((k) => embeds[k]).map((k) => E.label(k)))] : [];
      return `<p class="ob-desc">${t('長按任一演出，就能看表演者介紹、試聽串流音樂。')}</p>
        <div class="ob-mock" aria-hidden="true">
          <div class="lp-head" style="--c:${s.stage.c}"><span class="pill">${esc(s.stage.short)}</span><span class="lp-time">${fmt(s.start)} – ${fmt(s.end)}</span><span class="lp-dur">${t('{n} 分鐘', { n: s.end - s.start })}</span></div>
          <p class="lp-name">${esc(s.label)}</p>
          ${plats.length > 1 ? `<div class="emb-seg ob-seg">${plats.map((p, i) => `<button type="button" tabindex="-1" aria-selected="${i === 0}">${esc(p)}</button>`).join('')}</div>` : ''}
          ${playable() ? `<button type="button" class="ob-player ob-play" data-act="ob-play">▶ ${t('點一下試聽')}</button><div class="lp-embed ob-embed" hidden></div>` : `<div class="ob-player">♫ ${t('串流音樂預覽')}</div>`}
        </div>`;
    },
    // The real player, only once tapped: nothing from YouTube, Spotify or Apple loads before that (see 隱私說明).
    act: (name, b) => {
      if (name !== 'ob-play') return;
      const s = exampleShow();
      const box = sheet.querySelector('.ob-embed');
      if (window.FP_EMBED.render(box, ARTISTS[s.name].embeds, { dark: effectiveTheme() === 'dark', label: t })) {
        b.remove();
        sheet.querySelector('.ob-seg')?.remove(); // the player brings its own switcher
      } else {
        b.textContent = t('沒有網路，暫時沒辦法試聽');
      }
    },
  };
  // A real player can load here: the website with players on, and an example with one.
  function playable() {
    return !!(EVT.features && EVT.features.embeds && EVT.mode !== 'artifact' && window.FP_EMBED && ARTISTS[exampleShow().name]?.embeds);
  }
  const OB_MINE = {
    id: 'mine',
    icon: '🗺️',
    title: () => t('團序、時間表與地圖'),
    body: () => `<p class="ob-desc">${t('切換「我的團序」看已選的團和撞團，撞在一起可以抽籤決定。')}${$('mapBtn') ? t('下方的地圖按鈕可以看場地圖。') : ''}${hasBigInt ? t('換手機前，到「我的團序」按「複製備份連結」就能搬過去。') : ''}</p>`,
  };

  function showStep(i) {
    if (!ob || i < 0 || i >= ob.steps.length) return;
    ob.i = i;
    ob.shown.add(i);
    const { steps } = ob;
    const step = steps[i];
    const last = i === steps.length - 1;
    const cta = last && step.cta ? step.cta() : null; // e.g. 安裝, when the browser offers it
    const one = steps.length === 1;
    const left = cta ? ['ob-done', t('先不用')] : !last ? (i === 0 ? ['ob-skip', t('跳過')] : ['ob-back', t('上一步')]) : one ? null : ['ob-back', t('上一步')];
    const right = cta ? [cta.act, cta.label] : !last ? ['ob-next', t('下一步')] : one ? ['ob-done', '👌', t('知道了')] : ['ob-done', t('開始使用')];
    sheet.innerHTML = `<div class="ob" data-step="${esc(step.id)}">
        <div class="ob-icon" aria-hidden="true">${step.icon || ''}</div>
        <h2 id="sheetTitle">${esc(step.title())}</h2>
        <div class="ob-body">${step.body()}</div>
      </div>
      ${steps.length > 1 ? `<div class="ob-dots" role="img" aria-label="${esc(t('第 {i} 步，共 {n} 步', { i: i + 1, n: steps.length }))}">${steps.map((_, j) => `<i${j === i ? ' class="on"' : ''}></i>`).join('')}</div>` : ''}
      <div class="sheet-actions">${left ? `<button type="button" class="ghost" data-act="${left[0]}">${esc(left[1])}</button>` : ''}<button type="button" class="primary" data-act="${esc(right[0])}"${right[2] ? ` aria-label="${esc(right[2])}"` : ''}>${esc(right[1])}</button></div>`;
    sheet.scrollTop = 0;
    if (!sheet.hidden) sheet.querySelector('.primary').focus({ preventScroll: true });
  }

  function startOnboard() {
    if (!sheet.hidden) return; // a backup link's question is open: next time
    const returning = !!(store.get(KEY_ONBOARD) || store.get(KEY_HINT) || picks.size);
    const steps = [...(returning ? [] : [OB_PRESS, OB_MINE]), ...obAddOns.filter((st) => !st.due || st.due())];
    if (!steps.length) return;
    ob = { steps, i: 0, shown: new Set() };
    sheet.classList.add('ob-card');
    scrim.classList.add('ob-scrim');
    showStep(0);
    openSheet();
    // Nobody has touched the page yet: focus the card itself, so no button wears a focus ring on arrival.
    sheet.focus({ preventScroll: true });
  }

  function endOnboard() {
    if (!ob) return;
    const o = ob;
    ob = null;
    sheet.classList.remove('ob-card');
    scrim.classList.remove('ob-scrim');
    store.set(KEY_ONBOARD, '1');
    store.set(KEY_HINT, '1');
    o.steps.forEach((st, j) => { if (o.shown.has(j) && st.seen) st.seen(); });
  }

  /* ---------- copy (used by the backup link) ---------- */
  function openCopySheet(text, opener, title, sub) {
    sheet.innerHTML = `<div class="grab"></div>
      <h2 id="sheetTitle">${esc(title)}</h2>
      <p class="sub">${esc(t('{sub} 沒辦法自動複製，請長按下面的文字全選後複製。', { sub }))}</p>
      <textarea id="copyText" readonly rows="8">${esc(text)}</textarea>
      <div class="sheet-actions"><button type="button" class="primary" data-act="close">${t('完成')}</button></div>`;
    openSheet(opener);
    const ta = $('copyText');
    ta.focus();
    ta.select();
  }

  function copyText(text, opener, okMsg, title, sub) {
    try {
      navigator.clipboard.writeText(text).then(
        () => toast(okMsg),
        () => openCopySheet(text, opener, title, sub)
      );
    } catch (err) {
      openCopySheet(text, opener, title, sub);
    }
  }

  /* ---------- toast ---------- */
  const toastEl = $('toast');
  let toastTimer = null;
  function toast(msg, ms = 2400) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  /* ---------- long press → artist card ---------- */
  const LP_MS = 450;
  // fired: when a long press opened a card (ms). Its release click is ignored — but only right after it, so a
  // release that never reaches the board (it landed elsewhere) can't swallow the next real tap.
  const press = { timer: null, vis: null, x: 0, y: 0, el: null, fired: 0, type: '' };
  const lpCard = $('lpCard');
  const lpBackdrop = $('lpBackdrop');
  let lpArtists = [];
  let lpOpener = null;
  let lpHold = false;
  let lpCloseTimer = null;
  let lpShowId = null;
  let lpBillName = '';

  const PLATFORMS = [
    { key: 'spotify', label: 'Spotify' },
    { key: 'apple', label: 'Apple Music' },
    { key: 'youtube', label: 'YouTube' },
  ];
  // Which link button a player in the card stands in for (core/embed.js keys → artists.json "links" keys).
  const EMBED_LINK = { spotify: 'spotify', spotifyTrack: 'spotify', appleMusic: 'apple', appleMusicSong: 'apple', youtube: 'youtube' };
  // "A ft. B" and "A × B" are separate artists; scripts/validate.mjs splits the same way.
  function splitArtists(name) { return name.split(/\s+(?:ft\.|×)\s+/).map((a) => a.trim()).filter(Boolean); }

  function renderPlat(i) {
    const a = lpArtists[i];
    const entry = ARTISTS[a] || {};
    // Players inside the card (website, events with features.embeds); otherwise plain links to the artist pages.
    const embedded = !!(EVT.features && EVT.features.embeds && EVT.mode !== 'artifact' && window.FP_EMBED && entry.embeds)
      && window.FP_EMBED.render($('lpEmbed'), entry.embeds, { dark: effectiveTheme() === 'dark', label: t });
    if (!embedded && $('lpEmbed')) { $('lpEmbed').hidden = true; $('lpEmbed').innerHTML = ''; }
    // A platform with a player in the card needs no link button; one without a player keeps its link.
    const played = new Set(embedded ? Object.keys(entry.embeds).map((k) => EMBED_LINK[k]).filter(Boolean) : []);
    const links = entry.links || {};
    const avail = PLATFORMS.filter((p) => !played.has(p.key) && /^https:\/\//.test(links[p.key] || ''));
    const plat = $('lpPlat');
    plat.innerHTML = avail.map((p) =>
      `<a href="${esc(links[p.key])}" target="_blank" rel="noopener">${p.label}</a>`).join('');
    plat.hidden = !avail.length;
    lpCard.querySelectorAll('[data-lp-tab]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.lpTab) === i)));
    renderBio(a);
  }

  // A member without an intro of their own shows the billing's intro (official intros are often per billing).
  function renderBio(name) {
    const box = $('lpBio');
    if (!box) return;
    const a = ARTISTS[name] && ARTISTS[name].bio ? ARTISTS[name] : ARTISTS[lpBillName];
    box.hidden = false;
    if (!a || !a.bio) { box.innerHTML = `<p class="lp-none">${t('目前沒有找到可靠的介紹資料。')}</p>`; return; }
    const srcs = (a.sources || []).map((u) => {
      let host = '';
      try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
      return host ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(host)}</a>` : '';
    }).filter(Boolean);
    box.innerHTML = `${a.bio.split('\n').map((line) => `<p>${esc(line)}</p>`).join('')}${srcs.length ? `<div class="lp-src">${t('資料來源：')}${srcs.join(listSep)}</div>` : ''}`;
  }

  function openArtist(id, opener, holding) {
    const s = BYID.get(id);
    if (!s) return;
    clearTimeout(lpCloseTimer);
    lpOpener = opener || null;
    // Who the card covers: the billing's own members list, the whole billing when it has data of its own, nothing for
    // a talk without data, otherwise "A ft. B" / "A × B" split into artists.
    const own = ARTISTS[s.name];
    const hasData = (a) => !!a && (!!a.bio || !!(a.embeds && Object.keys(a.embeds).length) || !!(a.links && Object.keys(a.links).length));
    lpArtists = own?.members?.length ? own.members : hasData(own) ? [s.name] : s.note ? [] : splitArtists(s.name);
    lpBillName = s.name;
    const tabs = lpArtists.length > 1
      ? `<div class="lp-tabs" role="tablist" aria-label="${t('演出者')}">${lpArtists.map((a, i) => `<button type="button" role="tab" data-lp-tab="${i}" aria-selected="${i === 0}">${esc(a)}</button>`).join('')}</div>`
      : '';
    lpCard.innerHTML = `
      <div class="lp-head" style="--c:${s.stage.c}">
        <span class="pill">${esc(s.stage.short)}</span>
        <span class="lp-time">${fmt(s.start)} – ${fmt(s.end)}</span>
        <span class="lp-dur">${t('{n} 分鐘', { n: s.end - s.start })}</span>
        <button type="button" class="sr-only" data-lp="close">${t('關閉')}</button>
      </div>
      <h2 class="lp-name" id="lpName">${esc(s.label)}</h2>
      ${s.note ? `<p class="lp-note">${esc(s.note)}</p>` : ''}
      <div class="lp-act" id="lpAct"></div>
      ${lpArtists.length ? `${tabs}<div class="lp-embed" id="lpEmbed" hidden></div><div class="lp-plat" id="lpPlat"></div>` : ''}
      <div class="lp-bio" id="lpBio" hidden></div>`;
    lpShowId = s.id;
    renderLpAct();
    if (lpArtists.length) renderPlat(0);
    else renderBio(s.name);
    lpBackdrop.classList.remove('out');
    lpCard.classList.remove('out');
    // While the finger that opened the card is still down, let its release fall through
    // so it can't hit a link or the backdrop by accident.
    lpHold = !!holding;
    const pe = holding ? 'none' : '';
    lpBackdrop.style.pointerEvents = pe;
    lpCard.style.pointerEvents = pe;
    if (holding) setTimeout(releaseHold, 1500);
    lpBackdrop.hidden = false;
    lpCard.hidden = false;
    lpCard.setAttribute('tabindex', '-1');
    lpCard.focus({ preventScroll: true });
  }

  // Add, decide or switch a clash straight from the card.
  function renderLpAct() {
    const box = $('lpAct');
    const s = BYID.get(lpShowId);
    if (!box || !s) return;
    const on = picks.has(s.id);
    const alt = on && isAlt(s.id);
    const others = [...picks].filter((id) => id !== s.id && !isAlt(id)).map((id) => BYID.get(id)).filter((o) => overlap(o, s));
    const names = (list) => list.map((o) => `${fmt(o.start)} ${esc(o.label)}`).join(listSep);
    const btn = (act, label, cls) => `<button type="button" class="${cls}" data-lp-act="${act}">${label}</button>`;
    let html;
    if (!on && others.length) {
      html = `<div class="lp-warn"><b>${t('撞時段')}</b>${t('你選了 {list}', { list: names(others) })}</div>
        <div class="lp-btns">${btn('add', t('也加入，之後再選'), 'ghost')}${btn('choose-add', t('改去這團'), 'primary')}</div>`;
    } else if (!on) {
      html = `<div class="lp-btns">${btn('add', t('加入團序'), 'primary')}</div>`;
    } else if (alt) {
      const chosen = [...prefs].map((id) => BYID.get(id)).filter((p) => overlap(p, s));
      html = `<div class="lp-state">${t('目前是備選，要去的是 {list}', { list: names(chosen) })}</div>
        <div class="lp-btns">${btn('remove', t('移出團序'), 'ghost')}${btn('choose', t('改去這團'), 'primary')}</div>`;
    } else if (others.length) {
      html = `<div class="lp-warn"><b>${t('撞時段，還沒決定')}</b>${t('同時選了 {list}', { list: names(others) })}</div>
        <div class="lp-btns">${btn('remove', t('移出團序'), 'ghost')}${btn('choose', t('就去這團'), 'primary')}</div>`;
    } else {
      html = `<div class="lp-state">${prefs.has(s.id) ? `<span class="go">${t('要去')}</span>${t('撞團已決定')}` : `<b>${t('已在團序')}</b>`}</div>
        <div class="lp-btns">${btn('remove', t('移出團序'), 'ghost')}</div>`;
    }
    box.innerHTML = html;
  }
  function lpAct(act) {
    const s = BYID.get(lpShowId);
    if (!s) return;
    if (act === 'add') { addPick(s.id); commit(); toast(t('已加入 {name}', { name: s.label })); }
    else if (act === 'choose-add') { addPick(s.id); choose(s.id); commit(); toast(t('要去 {name}，撞到的改成備選', { name: s.label })); }
    else if (act === 'choose') { choose(s.id); commit(); toast(t('要去 {name}，撞到的改成備選', { name: s.label })); }
    else if (act === 'remove') { picks.delete(s.id); commit(); toast(t('已移除 {name}', { name: s.label })); }
  }

  function releaseHold() {
    if (!lpHold) return;
    lpHold = false;
    setTimeout(() => { lpBackdrop.style.pointerEvents = ''; lpCard.style.pointerEvents = ''; }, 80);
  }
  document.addEventListener('pointerup', releaseHold, true);
  document.addEventListener('pointercancel', releaseHold, true);

  function closeArtist() {
    if (lpCard.hidden) return;
    const done = () => {
      lpBackdrop.hidden = true;
      lpCard.hidden = true;
      lpCard.innerHTML = '';
      lpShowId = null;
      if (lpOpener && document.contains(lpOpener)) lpOpener.focus({ preventScroll: true });
    };
    if (reduceMotion()) { done(); return; }
    lpBackdrop.classList.add('out');
    lpCard.classList.add('out');
    lpCloseTimer = setTimeout(done, 200);
  }
  lpBackdrop.addEventListener('click', closeArtist);
  lpCard.addEventListener('click', (e) => {
    if (e.target.closest('[data-lp="close"]')) { closeArtist(); return; }
    const act = e.target.closest('[data-lp-act]');
    if (act) { lpAct(act.dataset.lpAct); return; }
    const tab = e.target.closest('[data-lp-tab]');
    if (tab) renderPlat(Number(tab.dataset.lpTab));
  });

  const pressTarget = (e) => e.target.closest('.block, .item, .alt-row');
  function cancelPress() {
    clearTimeout(press.timer);
    clearTimeout(press.vis);
    press.timer = null;
    if (press.el) press.el.classList.remove('pressing');
  }
  function startPress(e) {
    press.type = e.pointerType;
    const t = pressTarget(e);
    if (!t || e.target.closest('.draw, .choose, .alt-main')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelPress();
    press.fired = 0;
    press.el = t;
    press.x = e.clientX;
    press.y = e.clientY;
    press.vis = setTimeout(() => t.classList.add('pressing'), 140);
    press.timer = setTimeout(() => {
      press.timer = null;
      press.fired = Date.now();
      t.classList.remove('pressing');
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* no haptics on this device */ }
      openArtist(t.dataset.id, t, true);
    }, LP_MS);
  }
  function movePress(e) {
    if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress();
  }
  function consumePress() {
    const recent = press.fired && Date.now() - press.fired < 1000;
    press.fired = 0;
    return !!recent;
  }
  for (const host of [board, mineIn]) {
    host.addEventListener('pointerdown', startPress);
    host.addEventListener('pointermove', movePress);
    host.addEventListener('pointerup', cancelPress);
    host.addEventListener('pointercancel', cancelPress);
    host.addEventListener('pointerleave', cancelPress);
    host.addEventListener('contextmenu', (e) => {
      const t = pressTarget(e);
      if (!t) return;
      e.preventDefault();
      // Desktop: right-click opens the card. Touch long presses are handled by the timer.
      if (press.type === 'mouse' && !e.target.closest('.draw')) openArtist(t.dataset.id, t, false);
    });
  }

  /* ---------- dock height → --dock-h, so content can scroll clear of it ---------- */
  const dock = $('dock');
  const syncDock = () => root.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncDock).observe(dock);
  else addEventListener('resize', syncDock);
  syncDock();

  /* ---------- add-on API (pwa.js, cloud.js) ---------- */
  window.FP = {
    store,
    key,
    mmdd,
    toast,
    setSync,
    adopt,
    snapshot: () => ({ picks: [...picks], prefs: [...prefs], t: stamp }),
    t,
    lang,
    day: () => state.day,
    shows: () => SHOWS,
    stages: () => STAGES,
    festNow,
    locateShow: (id) => locateShow(id),
    onCommit: (fn) => { commitHooks.push(fn); },
    onboardStep: (step) => { obAddOns.push(step); },
    onboardRefresh: (id) => { if (ob && ob.steps[ob.i].id === id) showStep(ob.i); },
    onboardStart: () => startOnboard(),
    closeSheet: () => closeSheet(),
  };

  /* ---------- boot ---------- */
  // Static text in the page template: data-i18n (text) and data-i18n-attr (attributes) hold the Chinese as written.
  if (lang !== 'zh') {
    root.lang = 'en';
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.textContent.trim()); });
    document.querySelectorAll('[data-i18n-attr]').forEach((n) => n.dataset.i18nAttr.split(' ').forEach((a) => { if (n.hasAttribute(a)) n.setAttribute(a, t(n.getAttribute(a))); }));
    if (EVT.wordmark?.textEn) $('wordmarkText').textContent = EVT.wordmark.textEn;
    if (!EVT.header) $('topSub').textContent = subtitle; // two-line header: no official English for the place, so it stays
    dayBtns.forEach((b, i) => { const d = DAYS[DAY_NUMS[i]]; b.querySelector('.tab-sub').textContent = `${d.dow} ${d.date}`; });
  }
  // EN／中: offered when the event has English; switching reloads with the other language.
  const langBtn = $('langBtn');
  if (langBtn) {
    langBtn.textContent = lang === 'en' ? '中' : 'EN';
    langBtn.setAttribute('aria-label', lang === 'en' ? '切換成中文' : t('切換成英文'));
    langBtn.addEventListener('click', () => { store.set(KEY_LANG, lang === 'en' ? 'zh' : 'en'); location.reload(); });
  }
  renderGrid();
  setView(state.view);
  updateCounts();
  renderNext();
  requestAnimationFrame(scrollBoard);

  // #show-<id> (from an artist page's 在時間表上看): open on that show, then drop it from the address.
  const showLink = /^#show-(.+)$/.exec(location.hash || '');
  if (showLink && BYID.has(showLink[1])) {
    requestAnimationFrame(() => requestAnimationFrame(() => locateShow(showLink[1])));
    if (EVT.mode !== 'artifact') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* keep the hash */ } }
  }
  // A backup link (#p1-…) restores picks. Each link is handled once per browser.
  const tok = showLink ? '' : (location.hash || '').slice(1);
  if (tok && tok !== store.get(KEY_SEEN)) {
    const set = decodeToken(tok);
    if (set && set.size) {
      store.set(KEY_SEEN, tok);
      if (!sameSet(set, picks)) {
        if (!picks.size) {
          // Empty browser (new device, cleared data): take the link, but stamp it old
          // so a newer copy saved in the account (artifact) still wins.
          set.forEach((id) => picks.add(id));
          commit(1);
          toast(t('已從連結還原 {n} 團', { n: set.size }));
        } else {
          openLinkSheet(set);
        }
      }
    }
  }
  // First visit: the walkthrough, after the add-ons (pwa.js) have added their steps. Not over a backup link's
  // question, and not when arriving to see one show (#show-): those visitors get it next time.
  if (!showLink) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startOnboard, { once: true });
    else startOnboard();
  }
  // On the website, drop the token from the address so a reload or a home-screen shortcut doesn't carry it.
  if (tok && EVT.mode !== 'artifact') {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* keep the hash */ }
  }
})();
