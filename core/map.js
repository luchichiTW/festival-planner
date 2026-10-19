/* Venue map and official images (data/venue.json): opened from the dock's map button. Pinch or double-tap to zoom,
   drag to pan. On the map, tapping a stage shows what's on there and a walking-directions link (Apple Maps on
   iPhone, Google Maps elsewhere). Hotspots are percentages of the image, so they follow any zoom. */
(() => {
  const FP = window.FP;
  const V = window.FP_VENUE;
  const btn = document.getElementById('mapBtn');
  if (!FP || !V || !btn) return;
  const { t, lang } = FP;
  const en = lang === 'en';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Before the official map is out (venue.json "pending"): a note saying where it will be. With no other official
  // images, the button opens just the note; with some (the official timetables), the note is the first tab.
  const note = () => `
        <div class="ob-icon" aria-hidden="true">🗺️</div>
        <h2 id="mvWaitTitle">${t('場地圖')}</h2>
        <p>${t('官方還沒公布場地圖。公布後會放在這裡：點舞台就能看接下來的團、一鍵導航。')}</p>
        ${V.pending.url ? `<a class="pill-btn" href="${esc(V.pending.url)}" target="_blank" rel="noopener">${t('官網的場地資訊')}</a>` : ''}`;
  if (V.pending && !(V.images && V.images.length)) {
    const wait = document.createElement('div');
    wait.className = 'mv mv-wait';
    wait.hidden = true;
    wait.setAttribute('role', 'dialog');
    wait.setAttribute('aria-modal', 'true');
    wait.setAttribute('aria-labelledby', 'mvWaitTitle');
    wait.innerHTML = `
      <div class="mv-wait-in">${note()}
      </div>
      <div class="mv-bar"><div class="mv-fill"></div><button type="button" class="dock-btn mv-done" data-mv-close>${t('完成')}</button></div>`;
    document.body.append(wait);
    let back = null;
    const close = () => { wait.hidden = true; if (back && document.contains(back)) back.focus(); };
    btn.addEventListener('click', () => { back = document.activeElement; wait.hidden = false; wait.querySelector('[data-mv-close]').focus({ preventScroll: true }); });
    wait.addEventListener('click', (e) => { if (e.target.closest('[data-mv-close]')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wait.hidden) { e.stopPropagation(); close(); } }, true);
    window.FP_MAP = { open: () => btn.click(), close };
    return;
  }
  if (!(V.images && V.images.length)) return;
  const fmt = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const isApple = /iP(hone|od|ad)|Macintosh/.test(navigator.userAgent);
  const directions = ({ lat, lng }) => isApple
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

  const images = [
    ...(V.pending ? [{ pending: true, label: t('場地圖') }] : []),
    ...V.images.map((im) => ({ ...im, label: en && im.en ? im.en : im.label, file: en && im.srcEn ? im.srcEn : im.src })),
  ];
  // Hotspots line up with the map they were measured on; an English map with a different layout gets none.
  const spotsFor = (im) => (im.map && (!en || !im.srcEn || im.srcEn === im.src || V.map?.regionsEn) ? (en && V.map?.regionsEn) || V.map?.regions || {} : {});

  const ov = document.createElement('div');
  ov.className = 'mv';
  ov.hidden = true;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', t('場地圖與官方時間表'));
  ov.innerHTML = `
    <div class="mv-stage" id="mvStage"><div class="mv-pan" id="mvPan"><img id="mvImg" alt="" draggable="false"><div class="mv-spots" id="mvSpots"></div></div></div>
    ${V.pending ? `<div class="mv-wait-in" id="mvWait" hidden>${note()}</div>` : ''}
    <div class="mv-pop glass" id="mvPop" hidden></div>
    <div class="mv-bar">
      ${images.length > 1 ? `<div class="tabbar" role="tablist">${images.map((im, i) => `<button type="button" class="tab" role="tab" data-mv="${i}" aria-pressed="${i === 0}"><b>${esc(im.label)}</b></button>`).join('')}</div>` : '<div class="mv-fill"></div>'}
      <button type="button" class="dock-btn mv-done" data-mv-close>${t('完成')}</button>
    </div>`;
  document.body.append(ov);
  const stage = ov.querySelector('#mvStage');
  const pan = ov.querySelector('#mvPan');
  const img = ov.querySelector('#mvImg');
  const spots = ov.querySelector('#mvSpots');
  const pop = ov.querySelector('#mvPop');
  const wait = ov.querySelector('#mvWait');

  /* ---------- zoom & pan ---------- */
  const view = { s: 1, x: 0, y: 0, w: 0, h: 0, fitX: 0, fitY: 0 };
  function fit() {
    const r = stage.getBoundingClientRect();
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const k = Math.min(r.width / iw, r.height / ih);
    view.w = iw * k;
    view.h = ih * k;
    view.fitX = (r.width - view.w) / 2;
    view.fitY = (r.height - view.h) / 2;
    pan.style.width = `${view.w}px`;
    pan.style.height = `${view.h}px`;
    reset();
  }
  function clamp() {
    const r = stage.getBoundingClientRect();
    const sw = view.w * view.s;
    const sh = view.h * view.s;
    const lim = (pos, size, room, fit0) => (size <= room ? (room - size) / 2 - fit0 : Math.min(-fit0, Math.max(room - size - fit0, pos)));
    view.x = lim(view.x, sw, r.width, view.fitX);
    view.y = lim(view.y, sh, r.height, view.fitY);
  }
  function apply(animate) {
    clamp();
    pan.style.transition = animate ? 'transform .25s ease' : 'none';
    pan.style.transform = `translate(${view.fitX + view.x}px, ${view.fitY + view.y}px) scale(${view.s})`;
  }
  function reset() { view.s = 1; view.x = 0; view.y = 0; apply(false); }
  // Zoom to scale s keeping the stage point (px, py) still.
  function zoomAt(s, px, py, animate) {
    const ns = Math.min(6, Math.max(1, s));
    const ix = (px - view.fitX - view.x) / view.s;
    const iy = (py - view.fitY - view.y) / view.s;
    view.x = px - view.fitX - ix * ns;
    view.y = py - view.fitY - iy * ns;
    view.s = ns;
    apply(animate);
  }

  const pts = new Map();
  let start = null;
  let moved = 0;
  let downSpot = null; // pointer capture retargets later events to the stage, so remember the hotspot at touch-down
  let lastTap = 0;
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerdown', (e) => {
    if (!pts.size) downSpot = e.target.closest('[data-spot]');
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    moved = 0;
    const [a, b] = [...pts.values()];
    start = { s: view.s, x: view.x, y: view.y, a: { ...a }, d: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, m: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, local(e));
    const [a, b] = [...pts.values()];
    if (b && start.d) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.s = start.s; view.x = start.x + (m.x - start.m.x); view.y = start.y + (m.y - start.m.y);
      zoomAt(start.s * (d / start.d), m.x, m.y, false);
      moved = 99;
    } else if (!b) {
      const dx = a.x - start.a.x;
      const dy = a.y - start.a.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (view.s > 1) { view.x = start.x + dx; view.y = start.y + dy; apply(false); }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size) { const [a] = [...pts.values()]; start = { s: view.s, x: view.x, y: view.y, a: { ...a }, d: 0, m: null }; return; }
    if (moved > 8) return;
    if (downSpot) { openStage(downSpot.dataset.spot); downSpot = null; return; }
    const now = performance.now();
    if (now - lastTap < 300) { lastTap = 0; if (view.s > 1.05) { view.s = 1; view.x = 0; view.y = 0; apply(true); } else zoomAt(2.5, p.x, p.y, true); return; }
    lastTap = now;
    if (!pop.hidden) pop.hidden = true;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); });

  /* ---------- stage popup: what's on there, and directions ---------- */
  function openStage(id) {
    const st = FP.stages().find((s) => s.id === id);
    if (!st) return;
    const now = FP.festNow();
    const days = window.FP_EVENT.days.map((d) => d.date);
    const dayN = days.indexOf(now.iso) + 1;
    const day = dayN || FP.day();
    const list = FP.shows().filter((s) => s.stage.id === id && s.day === day && (!dayN || s.end > now.min)).slice(0, 4);
    const loc = V.map?.locations?.[id];
    pop.style.setProperty('--c', st.c);
    pop.innerHTML = `<div class="mv-pop-h"><i></i><b>${esc(st.name)}</b>${dayN ? `<span>${t('接下來')}</span>` : `<span>${esc(window.FP_EVENT.days[day - 1].label)}</span>`}</div>
      ${list.length ? `<div class="mv-list">${list.map((s) => `<button type="button" data-go="${s.id}"><span>${fmt(s.start)}</span>${esc(s.label)}</button>`).join('')}</div>` : `<p class="mv-none">${t('今天這個舞台沒有接下來的演出')}</p>`}
      ${loc ? `<a class="mv-go" href="${directions(loc)}" target="_blank" rel="noopener">${t('導航前往')}</a>` : ''}`;
    pop.hidden = false;
  }
  pop.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { close(); FP.locateShow(go.dataset.go); }
  });

  /* ---------- open / switch / close ---------- */
  let current = 0;
  function show(i) {
    current = i;
    pop.hidden = true;
    const im = images[i];
    ov.querySelectorAll('[data-mv]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.mv) === i)));
    stage.hidden = !!im.pending;
    if (wait) wait.hidden = !im.pending;
    if (im.pending) return;
    const regions = spotsFor(im);
    const st = FP.stages();
    spots.innerHTML = Object.entries(regions).map(([id, r]) => {
      const s = st.find((x) => x.id === id);
      return `<button type="button" data-spot="${id}" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%" aria-label="${esc(s ? s.name : id)}"></button>`;
    }).join('');
    img.alt = im.label;
    if (img.getAttribute('src') !== im.file) { img.onload = fit; img.src = im.file; } else fit();
  }
  let opener = null;
  function open() {
    opener = document.activeElement;
    ov.hidden = false;
    // An image for one day (venue.json "day"), e.g. that day's official timetable: open on the day the board shows.
    const forDay = images.findIndex((im) => im.day === FP.day());
    show(forDay >= 0 ? forDay : current);
    ov.querySelector('[data-mv-close]').focus();
  }
  function close() {
    ov.hidden = true;
    pop.hidden = true;
    if (opener && document.contains(opener)) opener.focus();
  }
  btn.addEventListener('click', open);
  ov.addEventListener('click', (e) => {
    if (e.target.closest('[data-mv-close]')) close();
    const tab = e.target.closest('[data-mv]');
    if (tab) show(Number(tab.dataset.mv));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) { e.stopPropagation(); close(); } }, true);
  addEventListener('resize', () => { if (!ov.hidden) fit(); });
  window.FP_MAP = { open, close, show };
})();
