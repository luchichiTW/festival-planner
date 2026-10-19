/* Liquid Glass motion, one piece for every tab bar (the dock, the map page). Styles: styles.css, "Liquid Glass".
   - A lens under the chosen tab: it follows whichever tab the app marks aria-pressed, slides and stretches on the way,
     swells under the finger, and follows a finger dragged across the bar (let go over a tab to choose it).
   - The dock shrinks while the timetable or 我的團序 scrolls down, and comes back on the way up or at the top.
   Runs last: every tab bar (map.js builds the map page's) is on the page by then. */
(() => {
  function lens(bar, { onPress } = {}) {
    const el = document.createElement('i');
    el.className = 'glass-lens';
    el.setAttribute('aria-hidden', 'true');
    bar.prepend(el);
    bar.classList.add('has-lens');
    const tabs = () => [...bar.querySelectorAll('.tab')];
    const chosen = () => tabs().find((t) => t.getAttribute('aria-pressed') === 'true');
    let at = null;
    // Layout positions (offsetLeft/Width), not screen ones: the dock may be mid-shrink (scaled) when this runs.
    // x: a finger's screen position, while dragging.
    function place(tab, { animate = true, x } = {}) {
      if (!tab) return;
      const w = bar.offsetWidth;
      if (!w) return; // hidden (the map page before it opens): placed when it shows
      let left = tab.offsetLeft;
      if (x !== undefined) {
        const box = bar.getBoundingClientRect();
        left = Math.max(4, Math.min(w - tab.offsetWidth - 4, (x - box.left) / (box.width / w || 1) - tab.offsetWidth / 2));
      }
      el.classList.toggle('still', !animate);
      if (animate && at && at !== tab) { el.classList.remove('moving'); void el.offsetWidth; el.classList.add('moving'); }
      el.style.width = `${tab.offsetWidth}px`;
      el.style.transform = `translateX(${left}px)`;
      at = tab;
    }
    new MutationObserver(() => place(chosen())).observe(bar, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    // Sized (and shown) without animating; resized (a wider window, a label that wraps) likewise.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => place(chosen(), { animate: false })).observe(bar);
    else addEventListener('resize', () => place(chosen(), { animate: false }));
    place(chosen(), { animate: false });

    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      drag = { id: e.pointerId, x0: e.clientX, moved: false };
      if (onPress) onPress();
      el.classList.add('held');
      place(tab);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        try { bar.setPointerCapture(e.pointerId); } catch (err) { console.warn('[fp] glass: no pointer capture, the drag ends at the bar edge', err); }
      }
      place(at, { animate: false, x: e.clientX });
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      el.classList.remove('held');
      if (drag.moved) {
        // A drag chooses the tab under the lens' middle; the click that follows the drag lands on the bar, not a tab.
        const b = el.getBoundingClientRect();
        const mid = b.left + b.width / 2;
        const target = tabs().find((t) => { const r = t.getBoundingClientRect(); return mid >= r.left && mid <= r.right; });
        if (target && target.getAttribute('aria-pressed') !== 'true') target.click();
        else place(chosen());
      } else if (e.type === 'pointercancel') place(chosen());
      drag = null;
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    // A tap that changes nothing (the chosen tab again) puts the lens back where it was.
    bar.addEventListener('click', () => setTimeout(() => place(chosen()), 0));
  }

  const dock = document.getElementById('dock');
  for (const bar of document.querySelectorAll('.tabbar')) {
    lens(bar, { onPress: dock && dock.contains(bar) ? () => dock.classList.remove('small') : null });
  }

  if (!dock) return;
  const last = new WeakMap();
  let run = 0; // how far the scrolling has gone in one direction
  document.addEventListener('scroll', (e) => {
    const box = e.target;
    if (!(box instanceof Element) || !box.matches('.board, .mine')) return;
    const y = box.scrollTop;
    const prev = last.has(box) ? last.get(box) : y;
    last.set(box, y);
    const dy = y - prev;
    if (!dy) return; // sideways on the timetable
    run = Math.sign(dy) === Math.sign(run) ? run + dy : dy;
    if (y < 24) dock.classList.remove('small');
    else if (run > 28) dock.classList.add('small');
    else if (run < -18) dock.classList.remove('small');
  }, true);
})();
