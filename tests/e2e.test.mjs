// Phone-width browser tests in headless Chrome (no packages; see scripts/lib/chrome.mjs).  node --test tests/
// Each test builds into a temp folder and serves it with scripts/serve.mjs, which redirects and caches like the live site.
// Set FP_E2E=0 to skip (e.g. on a machine without Chrome).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadEvent } from '../scripts/validate.mjs';
import { build } from '../scripts/build.mjs';
import { serve } from '../scripts/serve.mjs';
import { launch, sleep } from '../scripts/lib/chrome.mjs';

const SKIP = process.env.FP_E2E === '0';
const SLUG = 'vagabond2026';
const { schedule, artists, event: EV } = loadEvent(SLUG);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const PRE_FESTIVAL = '2026-10-20T12:00:00+08:00';

let chrome;
// Claude wraps an artifact's HTML in this document skeleton before showing it (doctype, viewport, base styles).
const CLAUDE_FRAME = (html) => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n' + html + '\n</body></html>';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-e2e-'));
after(async () => { if (chrome) await chrome.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// A fresh site folder: dist/<slug>/ of the given build id, the original artifact at /orig/, the built one at /art/.
function site(name, buildId) {
  const root = path.join(tmp, name);
  process.env.FP_BUILD = buildId;
  try { build(SLUG, { out: root, artifactOut: path.join(tmp, `${name}-art`) }); } finally { delete process.env.FP_BUILD; }
  for (const [dirName, src] of [['orig', path.join(ROOT, 'events', SLUG, 'artifact', 'index.html')], ['art', path.join(tmp, `${name}-art`, SLUG, 'index.html')]]) {
    fs.mkdirSync(path.join(root, dirName), { recursive: true });
    fs.writeFileSync(path.join(root, dirName, 'index.html'), CLAUDE_FRAME(fs.readFileSync(src, 'utf8')));
  }
  return root;
}
const rebuild = (root, buildId) => {
  process.env.FP_BUILD = buildId;
  try { build(SLUG, { out: root, artifactOut: path.join(tmp, 'rebuild-art') }); } finally { delete process.env.FP_BUILD; }
};

// Page with the festival clock set to `time` and a controllable page visibility (window.__fpSetVis).
async function open(url, { time = PRE_FESTIVAL, timezone = 'Asia/Taipei' } = {}) {
  const page = await chrome.newPage({ timezone });
  const t = Date.parse(time);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const off = ${t} - Date.now(); const R = Date;
    function D(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length ? new R(...a) : new R(R.now() + off); }
    D.prototype = R.prototype; D.now = () => R.now() + off; D.parse = R.parse; D.UTC = R.UTC; globalThis.Date = D;
    let v = 'visible';
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => v, configurable: true });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => v === 'hidden', configurable: true });
    window.__fpSetVis = (x) => { v = x; document.dispatchEvent(new Event('visibilitychange')); };
  })();` });
  await page.goto(url);
  await page.until(() => document.querySelectorAll('#grid .block').length > 0);
  return page;
}
const closePage = (page) => chrome.conn.send('Target.closeTarget', { targetId: page.targetId });
// Each test gets its own origin (a new port on the shared folder), so storage and service workers never leak between tests.
async function origin() {
  const s = await serve({ root: mainRoot, port: 0 });
  s.base = `http://127.0.0.1:${s.port}`;
  return s;
}

const readBoard = () => ({
  stages: [...document.querySelectorAll('#grid .sh b')].map((b) => b.textContent),
  cols: [...document.querySelectorAll('#grid .col')].map((c) => [...c.querySelectorAll('.block')].map((b) => [
    b.querySelector('.nt')?.textContent || '', b.querySelector('.nm').textContent, b.querySelector('.tm').textContent, b.style.top, b.style.height,
  ])),
});

let mainRoot; // shared read-only site for most tests
let main;
before(async () => {
  if (SKIP) return;
  chrome = await launch();
  mainRoot = site('main', 'e2e-main');
  main = await origin();
});
after(async () => { if (main) await main.close(); });

test('AC-01 /vagabond2026 redirects and both days match the artifact', { skip: SKIP }, async () => {
  const r = await fetch(`${main.base}/${SLUG}`, { redirect: 'manual' });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), `/${SLUG}/`);
  const orig = await open(`${main.base}/orig/`);
  const mine = await open(`${main.base}/${SLUG}`);
  assert.equal(await mine.eval('location.pathname'), `/${SLUG}/`);
  for (const day of [1, 2]) {
    for (const p of [orig, mine]) { await p.tap(`#day${day}`); await p.until((d) => document.getElementById(`day${d}`).getAttribute('aria-pressed') === 'true', { args: [day] }); }
    const a = await orig.eval(readBoard);
    const b = await mine.eval(readBoard);
    assert.deepEqual(b, a, `day ${day} board differs from the artifact`);
    assert.equal(b.cols.flat().length, schedule.filter((s) => s.day === day).length);
  }
  await closePage(orig);
  await closePage(mine);
});

test('AC-02 festival day: opens on today (festival time zone), now line, playing/ended, next up', { skip: SKIP }, async () => {
  const main = await origin();
  // 15:30 in Tainan on day 2, seen from a phone set to New York time.
  const page = await open(`${main.base}/${SLUG}/`, { time: '2026-11-08T15:30:00+08:00', timezone: 'America/New_York' });
  assert.equal(await page.eval(`document.getElementById('day2').getAttribute('aria-pressed')`), 'true');
  assert.equal(await page.eval(`document.querySelectorAll('#grid .nowline').length`), EV.stages.length);
  assert.equal(await page.eval(`document.querySelector('.nowtag').textContent`), '現在');
  const now = toMin('15:30');
  const day2 = schedule.filter((s) => s.day === 2);
  const expected = {
    ended: day2.filter((s) => toMin(s.end) <= now).map((s) => s.id).sort(),
    playing: day2.filter((s) => toMin(s.start) <= now && now < toMin(s.end)).map((s) => s.id).sort(),
  };
  const got = await page.eval(() => ({
    ended: [...document.querySelectorAll('.block.ended')].map((b) => b.dataset.id).sort(),
    playing: [...document.querySelectorAll('.block.playing')].map((b) => b.dataset.id).sort(),
  }));
  assert.deepEqual(got, expected);
  assert.equal(await page.eval(`document.getElementById('nextBar').hidden`), true);
  const live = expected.playing[0];
  const later = day2.find((s) => toMin(s.start) > now + 20).id;
  await page.tap(`.block[data-id="${live}"]`);
  await page.tap(`.block[data-id="${later}"]`);
  const bar = await page.eval(`document.getElementById('nextBar').innerText`);
  assert.match(bar, /演出中/);
  assert.match(bar, /下一團/);
  await closePage(page);

  // Day 1 opens on day 1 even after day 2 was viewed; before the festival there is no now line or next-up bar.
  const d1 = await open(`${main.base}/${SLUG}/`, { time: '2026-11-07T13:00:00+08:00' });
  assert.equal(await d1.eval(`document.getElementById('day1').getAttribute('aria-pressed')`), 'true');
  await closePage(d1);
  const pre = await open(`${main.base}/${SLUG}/`);
  assert.equal(await pre.eval(`document.querySelectorAll('.nowline, .block.ended, .block.playing').length`), 0);
  assert.equal(await pre.eval(`document.getElementById('nextBar').hidden`), true);
  await closePage(pre);
  await main.close();
});

test('AC-03 picks, clashes, deciding, lottery, search, card, theme — and they survive a reload', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  // Day 1, 17:50–18:30: 鯤鯓 Sunny Day Service, 金鶴廳 公館青少年 and 小嘻門 Multiverse Music overlap.
  await page.tap('.block[data-id="d1-sunny-day-service"]');
  await page.tap('.block[data-id="d1-ggteens"]');
  const marks = await page.eval(() => ({
    sel: [...document.querySelectorAll('.block.sel')].map((b) => b.dataset.id).sort(),
    tags: [...document.querySelectorAll('.block.sel .hit-tag')].map((t) => t.textContent),
    clash: document.querySelector('.block[data-id="d1-multiverse-music"]').classList.contains('clash'),
    count: document.getElementById('tabCount').textContent,
    clashBadge: document.getElementById('tabClash').textContent,
  }));
  assert.deepEqual(marks, { sel: ['d1-ggteens', 'd1-sunny-day-service'], tags: ['撞', '撞'], clash: true, count: '2', clashBadge: '撞 1' });

  await page.tap('#tabMine');
  await page.until(() => document.querySelector('.cluster .draw'));
  await page.tap('.choose[data-choose="d1-ggteens"]');
  await page.until(() => document.querySelector('.alt-row[data-id="d1-sunny-day-service"]'));
  assert.match(await page.eval(`document.querySelector('.cluster').innerText`), /已決定/);
  await page.tap('.redo');
  await page.until(() => document.querySelector('.cluster .draw'));
  await page.tap('.cluster .draw');
  await page.tap('[data-act="spin"]');
  await page.until(() => document.querySelector('[data-act="accept"]'), { ms: 15000 });
  await page.tap('[data-act="accept"]');
  await page.until(() => document.querySelectorAll('.alt-row').length === 1 && document.getElementById('tabClash').hidden);

  // Search: Chinese, English, and the near-miss row (ana → ano).
  await page.tap('#searchBtn');
  await page.type('ana');
  const res = await page.eval(`document.getElementById('spRes').innerText`);
  assert.match(res, /^ana/m);
  assert.match(res, /名字相近[\s\S]*ano/);
  await page.eval(`document.getElementById('spInput').value = 'Sorry Youth'; document.getElementById('spInput').dispatchEvent(new Event('input'))`);
  assert.match(await page.eval(`document.getElementById('spRes').innerText`), /拍謝少年/);
  await page.tap('#spClose');

  // Long press → artist card with bio, sources and the verified platform links.
  await page.tap('#tabPick');
  await page.longPress('.block[data-id="d1-ano"]');
  await page.until(() => !document.getElementById('lpCard').hidden);
  const card = await page.eval(() => ({
    name: document.getElementById('lpName').textContent,
    bio: document.querySelector('#lpBio p').textContent,
    plats: [...document.querySelectorAll('#lpPlat a')].map((a) => a.href),
  }));
  assert.equal(card.name, 'ano');
  assert.equal(card.bio, artists.ano.bio);
  assert.deepEqual(card.plats.sort(), Object.values(artists.ano.links).sort());
  assert.equal(await page.eval(`document.querySelector('.block[data-id="d1-ano"]').classList.contains('sel')`), false, 'a long press is not a tap');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.until(() => document.getElementById('lpCard').hidden);

  // Theme toggle persists; picks and decisions persist.
  const before = await page.eval(`document.documentElement.getAttribute('data-theme') || ''`);
  await page.tap('#themeBtn');
  const toggled = await page.eval(`document.documentElement.getAttribute('data-theme')`);
  assert.notEqual(toggled, before);
  const snap = await page.eval(`JSON.stringify(FP.snapshot().picks.sort())`);
  await page.reload();
  await page.until(() => document.querySelectorAll('#grid .block').length > 0);
  assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme')`), toggled);
  assert.equal(await page.eval(`JSON.stringify(FP.snapshot().picks.sort())`), snap);
  assert.equal(await page.eval(`localStorage.getItem('fp:${SLUG}:picks') !== null`), true, 'picks live under fp:<slug>:');
  await closePage(page);
  await main.close();
});

test('AC-04 every card: no-bio message where data is missing, only verified platform links', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  const split = (n) => n.split(/\s+(?:ft\.|×)\s+/).map((a) => a.trim()).filter(Boolean);
  for (const day of [1, 2]) {
    await page.tap(`#day${day}`);
    for (const s of schedule.filter((x) => x.day === day)) {
      const { x, y } = await page.center(`.block[data-id="${s.id}"]`);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
      await page.until(() => !document.getElementById('lpCard').hidden);
      const people = s.note ? (artists[s.name] ? [s.name] : []) : split(s.name);
      const seen = await page.eval((n) => {
        const out = [];
        const tabs = [...document.querySelectorAll('[data-lp-tab]')];
        for (let i = 0; i < Math.max(1, n); i++) {
          if (tabs[i]) tabs[i].click();
          out.push({
            bio: document.querySelector('#lpBio p')?.textContent || '',
            none: !!document.querySelector('#lpBio .lp-none'),
            links: [...document.querySelectorAll('#lpPlat a')].map((a) => a.getAttribute('href')),
          });
        }
        return out;
      }, people.length);
      if (!people.length) {
        assert.ok(seen[0].none, `${s.id}: talk without data shows the no-bio message`);
      }
      people.forEach((name, i) => {
        const a = artists[name];
        if (a?.bio) assert.equal(seen[i].bio, a.bio, `${s.id} / ${name}: bio`);
        else assert.ok(seen[i].none, `${s.id} / ${name}: no-bio message`);
        assert.deepEqual(seen[i].links.sort(), Object.values(a?.links || {}).sort(), `${s.id} / ${name}: links`);
      });
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.until(() => document.getElementById('lpCard').hidden);
    }
  }
  await closePage(page);
  await main.close();
});

test('TD-01 backup links made by the artifact restore on the website, by link and by paste', { skip: SKIP }, async () => {
  const main = await origin();
  // The artifact encodes a bit per show in its own board order — that order is each show's seq.
  const ids = ['d1-ano', 'd2-sunset-rollercoaster', 'd2-yenboi', 'd1-gao-xiao-gao-talk'];
  let n = 0n;
  for (const id of ids) n |= 1n << BigInt(schedule.find((s) => s.id === id).seq);
  const token = `p1-${n.toString(36)}`;
  // The artifact itself agrees on what the token means.
  const orig = await open(`${main.base}/orig/#${token}`);
  const origNames = await orig.eval(`JSON.parse(localStorage.getItem('vagabond26:picks')).picks.length`);
  assert.equal(origNames, ids.length);
  await closePage(orig);

  const page = await open(`${main.base}/${SLUG}/#${token}`);
  assert.deepEqual(await page.eval(`FP.snapshot().picks.sort()`), [...ids].sort());
  assert.equal(await page.eval('location.hash'), '', 'the token is dropped from the address');
  assert.match(await page.eval(`document.getElementById('toast').textContent`), /已從連結還原 4 團/);

  // Paste: with picks already there, it asks before replacing.
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('importBtn'));
  await page.tap('#importBtn');
  await page.eval((t) => { document.getElementById('importText').value = `https://claude.ai/artifact/abc#${t}`; }, `p1-${(1n << 5n).toString(36)}`);
  await page.tap('[data-act="import"]');
  await page.until(() => document.querySelector('[data-act="use-link"]'));
  await page.tap('[data-act="use-link"]');
  assert.deepEqual(await page.eval(`FP.snapshot().picks`), ['d1-ano']);
  await closePage(page);
  await main.close();
});

test('AC-08 loading the page only talks to its own origin', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await chrome.newPage();
  const urls = [];
  chrome.conn.listeners.add((m) => { if (m.sessionId === page.sessionId && m.method === 'Network.requestWillBeSent') urls.push(m.params.request.url); });
  await page.goto(`${main.base}/${SLUG}/`);
  await page.until(() => navigator.serviceWorker.controller !== null, { ms: 10000 });
  await sleep(500);
  const foreign = urls.filter((u) => !u.startsWith(main.base) && !u.startsWith('data:'));
  assert.deepEqual(foreign, []);
  assert.ok(urls.some((u) => u.endsWith('/fonts/display.woff2')), 'fonts come from the site itself');
  await closePage(page);
  await main.close();
});

test('P1-09 / AC-06 works offline after the first visit', { skip: SKIP }, async () => {
  const root = site('offline', 'e2e-offline');
  const srv = await serve({ root, port: 0 });
  const base = `http://127.0.0.1:${srv.port}`;
  const page = await open(`${base}/${SLUG}/`);
  await page.until(() => navigator.serviceWorker.controller !== null);
  await page.until(async () => (await caches.keys()).includes('fp-vagabond2026-e2e-offline'));
  await page.tap('.block[data-id="d1-nell"]');
  await srv.close(); // the network is gone
  await page.reload();
  await page.until(() => document.querySelectorAll('#grid .block').length > 0);
  const state = await page.eval(() => ({
    build: FP_EVENT.build, picks: FP.snapshot().picks, fonts: document.fonts.check('900 20px "Chiron GoRound TC"'),
  }));
  assert.deepEqual(state, { build: 'e2e-offline', picks: ['d1-nell'], fonts: true });
  // A fresh open (as from the home screen, with a query) also comes from the cache.
  await page.goto(`${base}/${SLUG}/?source=homescreen`);
  await page.until(() => document.querySelectorAll('#grid .block').length > 0);
  await page.tap('#tabMine');
  await page.until(() => document.querySelector('.item[data-id="d1-nell"]'));
  await closePage(page);
});

test('AC-07 a new deploy switches in only when nobody is using the page, and keeps the picks', { skip: SKIP }, async () => {
  const root = site('update', 'e2e-v1');
  const srv = await serve({ root, port: 0 });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const page = await open(`${base}/${SLUG}/`);
    await page.until(() => navigator.serviceWorker.controller !== null);
    await page.tap('#day2');
    await page.tap('.block[data-id="d2-milena"]');
    const consistent = () => ({ build: FP_EVENT.build, meta: document.querySelector('meta[name="fp-build"]').content });

    // v2 is deployed. Opening the app again: the cached v1 page shows first (never v2 HTML with v1 files), v2
    // downloads, and since nothing was touched yet it takes over at once and says so.
    rebuild(root, 'e2e-v2');
    await page.reload();
    await page.until(() => FP_EVENT.build === 'e2e-v2', { ms: 15000 });
    assert.deepEqual(await page.eval(consistent), { build: 'e2e-v2', meta: 'e2e-v2' });
    await page.until(() => /已更新到 10\/17 的時間表/.test(document.getElementById('toast').textContent));
    assert.deepEqual(await page.eval(`FP.snapshot().picks`), ['d2-milena']);

    // v3 is deployed while someone is using the page: it downloads but waits. (Tap first: an update found in the
    // first seconds after opening, untouched, is meant to switch in at once — the browser checks right after a load.)
    await page.tap('.block[data-id="d2-coldrain"]');
    rebuild(root, 'e2e-v3');
    await page.eval(`window.__stillHere = true; navigator.serviceWorker.getRegistration().then((r) => r.update())`);
    await page.until(async () => !!(await navigator.serviceWorker.getRegistration()).waiting, { ms: 15000 }).catch(async (e) => {
      const st = await page.eval(`navigator.serviceWorker.getRegistration().then((r) => JSON.stringify({ installing: r.installing?.state, waiting: r.waiting?.state, active: r.active?.state, build: FP_EVENT.build, here: window.__stillHere }))`);
      throw new Error(`${e.message}\nservice worker: ${st}`);
    });
    await sleep(800);
    assert.deepEqual(await page.eval(`[FP_EVENT.build, window.__stillHere]`), ['e2e-v2', true], 'no reload while in use');

    // The app goes to the background → v3 takes over; coming back shows v3 with the picks intact.
    const reloaded = page.waitFor('Page.loadEventFired', () => true, 15000);
    await page.eval(`window.__fpSetVis('hidden')`);
    await reloaded;
    await page.until(() => document.querySelectorAll('#grid .block').length > 0 && FP_EVENT.build === 'e2e-v3');
    assert.deepEqual(await page.eval(consistent), { build: 'e2e-v3', meta: 'e2e-v3' });
    assert.deepEqual((await page.eval(`FP.snapshot().picks`)).sort(), ['d2-coldrain', 'd2-milena']);
    assert.equal(await page.eval(`caches.keys().then((k) => k.filter((x) => x.startsWith('fp-vagabond2026-')).join())`), 'fp-vagabond2026-e2e-v3', 'old caches are removed');
    await closePage(page);
  } finally {
    await srv.close();
  }
});

test('the built single-file artifact runs on its own, without service worker or install hint', { skip: SKIP }, async () => {
  const page = await open(`${main.base}/art/`);
  const s = await page.eval(() => ({
    mode: FP_EVENT.mode, blocks: document.querySelectorAll('#grid .block').length,
    hint: document.getElementById('installHint'), sw: !!navigator.serviceWorker.controller,
  }));
  assert.deepEqual(s, { mode: 'artifact', blocks: schedule.filter((x) => x.day === 1).length, hint: null, sw: false });
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('syncNote'));
  assert.match(await page.eval(`document.getElementById('syncNote').textContent`), /存在這個瀏覽器裡/);
  await closePage(page);
});
