// Phone-width browser tests in headless Chrome (no packages; see scripts/lib/chrome.mjs).  node --test tests/
// Each test builds into a temp folder and serves it with scripts/serve.mjs, which redirects and caches like the live site.
// Set FP_E2E=0 to skip (e.g. on a machine without Chrome).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadEvent } from '../scripts/validate.mjs';
import { build, buildSite } from '../scripts/build.mjs';
import { serve } from '../scripts/serve.mjs';
import { launch, sleep } from '../scripts/lib/chrome.mjs';

const SKIP = process.env.FP_E2E === '0';
const SLUG = 'vagabond2026';
const { schedule, artists, event: EV } = loadEvent(SLUG);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const PRE_FESTIVAL = '2026-10-20T12:00:00+08:00';

let chrome;
// Requests to other sites. Allowed: data: URIs, and Cloudflare Web Analytics, which Cloudflare adds to the live pages
// at its edge (never in this repo, so the local server here never shows it).
const foreignOf = (urls, base) => urls.filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !/^https:\/\/(static\.)?cloudflareinsights\.com\//.test(u));
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
async function open(url, { time = PRE_FESTIVAL, timezone = 'Asia/Taipei', safeArea, theme, width, height, mobile, ready = () => document.querySelectorAll('#grid .block').length > 0 } = {}) {
  const page = await chrome.newPage({ timezone, safeArea, width, height, mobile, touch: mobile !== false });
  if (theme) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const t = Date.parse(time);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const off = ${t} - Date.now(); const R = Date;
    function D(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length ? new R(...a) : new R(R.now() + off); }
    D.prototype = R.prototype; D.now = () => R.now() + off; D.parse = R.parse; D.UTC = R.UTC; globalThis.Date = D;
    let v = 'visible';
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => v, configurable: true });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => v === 'hidden', configurable: true });
    window.__fpSetVis = (x) => { v = x; document.dispatchEvent(new Event('visibilitychange')); };
    Object.defineProperty(Navigator.prototype, 'language', { get: () => 'zh-TW', configurable: true }); // a Taiwanese phone
  })();` });
  await page.goto(url);
  await page.until(ready);
  // Let the app's own first-frame scroll (scrollBoard) happen before the test touches anything.
  await page.send('Page.bringToFront');
  await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  return page;
}
const closePage = (page) => chrome.conn.send('Target.closeTarget', { targetId: page.targetId });
// Each test gets its own origin (a new port on the shared folder), so storage and service workers never leak between tests.
const servers = [];
async function origin() {
  const s = await serve({ root: mainRoot, port: 0 });
  s.base = `http://127.0.0.1:${s.port}`;
  servers.push(s);
  return s;
}
// Close every per-test server even when a test fails half-way (an open server keeps node:test from exiting).
after(async () => { for (const s of servers) await s.close().catch(() => {}); });

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
  process.env.FP_BUILD = 'e2e-main';
  try {
    build('megaport2026', { out: mainRoot, artifactOut: path.join(tmp, 'main-mp-art') });
    build('megaport2027', { out: mainRoot, artifactOut: path.join(tmp, 'main-mp-art') });
  } finally { delete process.env.FP_BUILD; }
  buildSite({ out: mainRoot });
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
    mineSub: document.getElementById('mineSub').textContent,
  }));
  assert.deepEqual(marks, { sel: ['d1-ggteens', 'd1-sunny-day-service'], tags: ['撞', '撞'], clash: true, mineSub: '2 團 · 撞 1' });

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
  await page.until(() => document.querySelectorAll('.alt-row').length === 1 && document.getElementById('mineSub').textContent === '2 團');

  // Search: Chinese, English, and the near-miss row (ana → ano).
  await page.tap('#searchBtn');
  await page.type('ana');
  const res = await page.eval(`document.getElementById('spRes').innerText`);
  assert.match(res, /^ana/m);
  assert.match(res, /名字相近[\s\S]*ano/);
  await page.eval(`document.getElementById('spInput').value = 'Sorry Youth'; document.getElementById('spInput').dispatchEvent(new Event('input'))`);
  assert.match(await page.eval(`document.getElementById('spRes').innerText`), /拍謝少年/);
  await page.tap('#spClose');

  // Long press → artist card with bio, sources and a recommended song per platform (players, not loaded here).
  await page.send('Network.setBlockedURLs', { urls: ['*open.spotify.com*', '*embed.music.apple.com*', '*youtube-nocookie.com*'] });
  await page.tap('#day1');
  await page.longPress('.block[data-id="d1-ano"]');
  await page.until(() => !document.getElementById('lpCard').hidden);
  const card = await page.eval(() => ({
    name: document.getElementById('lpName').textContent,
    bio: document.querySelector('#lpBio p').textContent,
    players: [...document.querySelectorAll('#lpEmbed [data-emb]')].map((b) => b.dataset.emb),
  }));
  assert.equal(card.name, 'ano');
  assert.equal(card.bio, artists.ano.bio);
  assert.deepEqual(card.players, Object.keys(artists.ano.embeds));
  assert.equal(await page.eval(`document.querySelector('.block[data-id="d1-ano"]').classList.contains('sel')`), false, 'a long press is not a tap');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.until(() => document.getElementById('lpCard').hidden);

  // Theme (set in 關於) persists; picks and decisions persist.
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('aboutBtn'));
  await page.tap('#aboutBtn');
  await page.tap('[data-theme-set="dark"]');
  const toggled = await page.eval(`document.documentElement.getAttribute('data-theme')`);
  assert.equal(toggled, 'dark');
  const snap = await page.eval(`JSON.stringify(FP.snapshot().picks.sort())`);
  await page.reload();
  await page.until(() => document.querySelectorAll('#grid .block').length > 0);
  assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme')`), toggled);
  assert.equal(await page.eval(`JSON.stringify(FP.snapshot().picks.sort())`), snap);
  assert.equal(await page.eval(`localStorage.getItem('fp:${SLUG}:picks') !== null`), true, 'picks live under fp:<slug>:');
  await closePage(page);
  await main.close();
});

// Third-party players stay out of the tests: the cards still build their iframes, nothing loads.
const PLAYER_HOSTS = ['*open.spotify.com*', '*embed.music.apple.com*', '*youtube-nocookie.com*', '*streetvoice.com*'];
const EMBED_LINK = { spotify: 'spotify', spotifyTrack: 'spotify', appleMusic: 'apple', appleMusicSong: 'apple', youtube: 'youtube' };

test('AC-04 every card: no-bio message where data is missing, a player or a verified link per platform', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  await page.send('Network.setBlockedURLs', { urls: PLAYER_HOSTS });
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
            players: [...document.querySelectorAll('#lpEmbed [data-emb]')].map((b) => b.dataset.emb),
            frame: document.querySelector('#lpEmbed iframe')?.getAttribute('src') || '',
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
        const played = Object.keys(a?.embeds || {});
        const covered = new Set(played.map((k) => EMBED_LINK[k]));
        const links = Object.entries(a?.links || {}).filter(([k]) => !covered.has(k)).map(([, u]) => u);
        assert.deepEqual(seen[i].links.sort(), links.sort(), `${s.id} / ${name}: links for platforms without a player`);
        if (played.length > 1) assert.deepEqual(seen[i].players, played, `${s.id} / ${name}: one tab per player`);
        if (played.length) assert.ok(seen[i].frame.includes(a.embeds[played[0]].split('?i=')[0]), `${s.id} / ${name}: first player shows the picked song`);
        else assert.equal(seen[i].frame, '', `${s.id} / ${name}: no player without picks`);
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
  const foreign = foreignOf(urls, main.base);
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

test('iPhone layout: glass header under the status bar, floating tab bar, content to the bottom, no scrollbars, edge fade', { skip: SKIP }, async () => {
  const main = await origin();
  const IPHONE = { top: 59, bottom: 34 };
  const html = await (await fetch(`${main.base}/${SLUG}/`)).text();
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);

  const layout = () => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const top = document.querySelector('.top');
    const tr = top.getBoundingClientRect();
    const bar = document.querySelector('.tabbar');
    const br = bar.getBoundingClientRect();
    const board = document.getElementById('board').getBoundingClientRect();
    return {
      rootPad: [css(document.documentElement).paddingTop, css(document.documentElement).paddingBottom],
      header: { top: Math.round(tr.top), left: Math.round(tr.left), right: Math.round(tr.right), radius: parseFloat(css(top).borderBottomLeftRadius), sticky: css(top).position === 'sticky', pageColour: css(top).backgroundColor === css(document.body).backgroundColor },
      wordmarkTop: Math.round(document.querySelector('.wordmark').getBoundingClientRect().top),
      wordmarkShadow: css(document.querySelector('.wordmark')).textShadow,
      strip: css(document.body, '::before').content,
      bar: { top: Math.round(br.top), bottom: Math.round(br.bottom), left: Math.round(br.left), right: Math.round(br.right), radius: parseFloat(css(bar).borderTopLeftRadius), blur: /blur/.test(css(bar).backdropFilter || css(bar).webkitBackdropFilter) },
      boardBottom: Math.round(board.bottom),
      seam: Math.round(board.top - tr.bottom),
      sameColour: css(top).backgroundColor === css(document.querySelector('.sh')).backgroundColor,
      scrollbars: ['.board', '.mine', '.sp-res', '.sheet', '.lp-card'].map((sel) => css(document.querySelector(sel)).scrollbarWidth),
      w: innerWidth, h: innerHeight,
    };
  };

  const dark = await open(`${main.base}/${SLUG}/`, { safeArea: IPHONE, theme: 'dark' });
  const d = await dark.eval(layout);
  assert.deepEqual(d.rootPad, ['0px', '0px'], 'no padding around the whole page');
  assert.equal(d.strip, 'none', 'no solid strip painted under the status bar');
  assert.deepEqual([d.header.top, d.header.left, d.header.right], [0, 0, d.w], 'glass header runs edge to edge from the top');
  assert.equal(d.seam, 0, 'header and stage-name row meet with no gap');
  assert.ok(d.sameColour, 'header and stage-name row are one colour');
  assert.ok(!d.header.sticky, 'header is not sticky (iOS 26 blurs sticky top bars, wordmark included)');
  assert.ok(d.header.pageColour, 'header is painted in the page colour, matching the band iOS draws under the clock');
  assert.ok(d.wordmarkTop >= IPHONE.top, `header content clears the status bar (${d.wordmarkTop})`);
  assert.ok(d.bar.radius >= 20 && d.bar.blur, 'tab bar is a glass capsule');
  assert.ok(d.bar.left > 0 && d.bar.right < d.w, 'capsule floats clear of the screen sides');
  assert.ok(d.bar.bottom <= d.h - 20, `capsule sits above the home indicator (${d.bar.bottom}/${d.h})`);
  assert.ok(d.bar.bottom - d.bar.top <= 60, 'capsule is no taller than a tab bar');
  assert.equal(d.boardBottom, d.h, 'timetable runs to the bottom edge, under the capsule');
  assert.deepEqual(d.scrollbars, ['none', 'none', 'none', 'none', 'none']);
  // The last show and the end of 我的團序 can scroll clear of the capsule.
  const lastClear = await dark.eval(async () => {
    const b = document.getElementById('board');
    b.scrollTop = b.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const blocks = [...document.querySelectorAll('#grid .block')];
    const lowest = Math.max(...blocks.map((x) => x.getBoundingClientRect().bottom));
    return lowest <= document.querySelector('.tabbar').getBoundingClientRect().top;
  });
  assert.ok(lastClear, 'the latest show scrolls above the capsule');
  await dark.tap('#tabMine');
  await dark.until(() => document.getElementById('aboutBtn'));
  const mineClear = await dark.eval(async () => {
    const m = document.getElementById('mineView');
    m.scrollTop = m.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.getElementById('aboutBtn').getBoundingClientRect().bottom <= document.querySelector('.tabbar').getBoundingClientRect().top;
  });
  assert.ok(mineClear, 'the end of 我的團序 scrolls above the capsule');
  await dark.tap('#aboutBtn');
  const scrim = await dark.eval(() => { const r = document.getElementById('scrim').getBoundingClientRect(); return { top: r.top, h: r.height }; });
  assert.deepEqual(scrim, { top: 0, h: d.h }, 'the sheet scrim covers the status bar area too');
  await closePage(dark);

  // Light: same glass, and the wordmark has no doubled shadow.
  const light = await open(`${main.base}/${SLUG}/`, { safeArea: IPHONE, theme: 'light' });
  const l = await light.eval(layout);
  assert.equal(l.strip, 'none');
  assert.ok(l.header.pageColour && l.bar.blur);
  assert.match(l.wordmarkShadow, /^(none|(rgba\(0, 0, 0, 0\)[^,]*,?\s*)+)$/, `light wordmark has no visible shadow (${l.wordmarkShadow})`);

  // More stages to the right → fade on the right edge, gone once scrolled to the end. (This origin reopens on
  // 我的團序 from the dark run; switching to 排團 must recompute the fade.)
  await light.tap('#day1');
  assert.equal(await light.eval(`document.getElementById('pickView').classList.contains('more-right')`), true);
  await light.until(() => getComputedStyle(document.getElementById('pickView'), '::after').opacity === '1');
  await light.eval(`(() => { const b = document.getElementById('board'); b.scrollLeft = b.scrollWidth; b.dispatchEvent(new Event('scroll')); })()`);
  await light.until(() => !document.getElementById('pickView').classList.contains('more-right'));
  await closePage(light);
  const wide = await open(`${main.base}/${SLUG}/`, { width: 1280, height: 900, mobile: false });
  assert.equal(await wide.eval(`document.getElementById('pickView').classList.contains('more-right')`), false, 'all stages fit: no fade');
  await closePage(wide);
  await main.close();
});

test('no redundant cues on things that are obviously tappable (no 前往, no arrows, no tap hints)', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  await page.tap('#searchBtn');
  assert.equal(await page.eval(`document.getElementById('spRes').innerText.trim()`), '', 'empty search: the placeholder says enough');
  await page.type('落日');
  const item = await page.eval(() => ({ text: document.querySelector('.sp-item').innerText, go: !!document.querySelector('.sp-go') }));
  assert.equal(item.go, false);
  assert.doesNotMatch(item.text, /前往|→/);
  await page.tap('#spClose');
  await page.longPress('.block[data-id="d1-ano"]');
  await page.until(() => !document.getElementById('lpCard').hidden);
  const card = await page.eval(() => ({ plats: [...document.querySelectorAll('#lpEmbed [data-emb], #lpPlat a')].map((a) => a.textContent), hint: !!document.getElementById('lpHint') }));
  assert.deepEqual(card, { plats: ['Spotify', 'Apple Music', 'YouTube'], hint: false });
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.until(() => document.getElementById('lpCard').hidden);
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('aboutBtn'));
  await page.tap('#aboutBtn');
  const about = await page.eval(() => [...document.querySelectorAll('.about-links a b')].map((b) => b.textContent + getComputedStyle(b, '::after').content));
  assert.deepEqual(about, ['原始碼none', 'CLAUDE.mdnone', '原始 artifactnone']);
  await closePage(page);
  await main.close();
});

// Every text box fits: nothing cut off, no "…", at common phone widths.
const CLIPPED = () => {
  const out = [];
  // Clipped = the box hides overflow (or truncates with …) and its content is larger than the box.
  const clipped = (el) => {
    if (el.offsetParent === null) return false;
    const cs = getComputedStyle(el);
    const hides = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
    return hides && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  };
  for (const b of document.querySelectorAll('#grid .block')) {
    if (b.offsetParent === null) continue;
    const kids = [...b.children].filter((c) => !c.classList.contains('hit-tag') && !c.classList.contains('bprog'));
    const used = kids.reduce((n, c) => n + c.getBoundingClientRect().height, 0);
    if (kids.some(clipped) || used > b.clientHeight - 4) out.push(b.dataset.id);
  }
  for (const el of document.querySelectorAll('.tab, .tab *, .sp-item *, .nx *, .alt-row *, .wordmark, .top-sub')) if (clipped(el)) out.push(`${el.className || el.tagName}:${el.textContent.trim().slice(0, 20)}`);
  return out;
};

test('controls live at the bottom: day tabs, 我的團序 and search in the dock; header has none', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`, { safeArea: { top: 59, bottom: 34 } });
  const lay = await page.eval(() => {
    const dock = document.querySelector('.dock-row').getBoundingClientRect();
    const ids = ['day1', 'day2', 'tabMine', 'searchBtn'].map((id) => document.getElementById(id).getBoundingClientRect());
    return { headerButtons: [...document.querySelectorAll('.top button')].map((b) => b.id).join(), dockTop: dock.top, h: innerHeight, inDock: ids.every((r) => r.top >= dock.top - 1 && r.bottom <= dock.bottom + 1), lowest: Math.max(...ids.map((r) => r.bottom)) };
  });
  assert.equal(lay.headerButtons, 'themeBtn', 'the header only holds the light/dark switch');
  assert.ok(lay.inDock, 'day tabs, 我的團序 and search sit in the bottom dock');
  assert.ok(lay.dockTop > lay.h * 0.8, `dock is in the thumb zone (${Math.round(lay.dockTop)}/${lay.h})`);
  assert.ok(lay.lowest <= lay.h - 20, 'controls clear the home indicator');

  // Day tabs switch the board; from 我的團序 they bring the board back on that day.
  await page.tap('#day2');
  assert.equal(await page.eval(`document.getElementById('day2').getAttribute('aria-pressed') + document.getElementById('pickView').hidden`), 'truefalse');
  await page.tap('.block[data-id="d2-coldrain"]');
  await page.tap('.block[data-id="d2-milena"]');
  await page.tap('#day1');
  await page.tap('.block[data-id="d1-sunny-day-service"]');
  await page.tap('.block[data-id="d1-ggteens"]');
  assert.equal(await page.eval(`document.getElementById('mineSub').textContent`), '4 團 · 撞 1', 'count and clash as the tab\'s second line');
  await page.tap('#tabMine');
  assert.equal(await page.eval(`[document.getElementById('tabMine').getAttribute('aria-pressed'), document.getElementById('day1').getAttribute('aria-pressed')].join()`), 'true,false');
  await page.tap('#day2');
  assert.equal(await page.eval(`[document.getElementById('mineView').hidden, document.getElementById('day2').getAttribute('aria-pressed')].join()`), 'true,true');

  // Search opens at the bottom, field last (closest to the thumb and the keyboard).
  await page.tap('#searchBtn');
  await page.until(() => document.getElementById('sp').getAnimations().every((a) => a.playState === 'finished'));
  const sp = await page.eval(() => { const s = document.getElementById('sp').getBoundingClientRect(); const f = document.getElementById('spInput').getBoundingClientRect(); return { bottom: Math.round(s.bottom), field: Math.round(f.bottom), h: innerHeight }; });
  assert.equal(sp.bottom, sp.h, 'search panel is anchored to the bottom');
  assert.ok(sp.field > sp.h - 110, `search field near the bottom (${sp.field}/${sp.h})`);
  await page.type('ana');
  assert.match(await page.eval(`document.getElementById('spRes').innerText`), /名字相近[\s\S]*ano/);
  await page.tap('#spClose');

  // Theme lives in 關於: follow the system, or force light / dark; remembered.
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('aboutBtn'));
  await page.tap('#aboutBtn');
  const opts = await page.eval(() => [...document.querySelectorAll('[data-theme-set]')].map((b) => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : '')));
  assert.deepEqual(opts, ['跟隨系統*', '淺色', '深色']);
  await page.tap('[data-theme-set="light"]');
  assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme')`), 'light');
  await page.reload();
  await page.until(() => document.querySelectorAll('#grid .block').length > 0 || !document.getElementById('mineView').hidden);
  assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme')`), 'light');
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('aboutBtn'));
  await page.tap('#aboutBtn');
  await page.tap('[data-theme-set="system"]');
  assert.equal(await page.eval(`document.documentElement.hasAttribute('data-theme')`), false);
  await closePage(page);
  await main.close();
});

test('no text is cut off or replaced with "…" at 390, 375 and 320 px', { skip: SKIP }, async () => {
  const main = await origin();
  for (const width of [390, 375, 320]) {
    const page = await open(`${main.base}/${SLUG}/`, { width, height: 844, time: '2026-11-08T15:30:00+08:00' });
    await page.eval('document.fonts.ready');
    const found = [];
    for (const d of [1, 2]) {
      await page.tap(`#day${d}`);
      await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
      found.push(...await page.eval(CLIPPED));
    }
    // A long billing in the next-up bar, the search list and a 備選 row.
    await page.tap('.block[data-id="d2-whateveryousay-talk"]');
    await page.tap('.block[data-id="d2-robot-swing"]');
    await page.tap('.block[data-id="d2-azikazin-magic-world"]');
    await page.tap('#searchBtn');
    await page.type('A_Root');
    found.push(...await page.eval(CLIPPED));
    await page.tap('#spClose');
    await page.tap('#tabMine');
    await page.until(() => document.getElementById('aboutBtn'));
    found.push(...await page.eval(CLIPPED));
    assert.deepEqual([...new Set(found)], [], `clipped at ${width}px`);
    await closePage(page);
  }
  await main.close();
});

test('light/dark switch in the header flips the theme and stays in sync with 關於', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`, { theme: 'dark' });
  assert.equal(await page.eval(`document.getElementById('themeBtn').getAttribute('aria-label')`), '切換成淺色模式');
  await page.tap('#themeBtn');
  assert.equal(await page.eval(`document.documentElement.getAttribute('data-theme') + '|' + document.getElementById('themeBtn').getAttribute('aria-label')`), 'light|切換成深色模式');
  await page.tap('#tabMine');
  await page.until(() => document.getElementById('aboutBtn'));
  await page.tap('#aboutBtn');
  assert.equal(await page.eval(`document.querySelector('[data-theme-set][aria-checked="true"]').dataset.themeSet`), 'light');
  await page.tap('[data-theme-set="system"]');
  assert.equal(await page.eval(`document.getElementById('themeBtn').getAttribute('aria-label')`), '切換成淺色模式', 'back to the system (dark) theme');
  await closePage(page);
  await main.close();
});

test('no × buttons: tap a 我的團序 item for its card (remove from there); tap outside to close the card', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  await page.tap('.block[data-id="d1-nell"]');
  await page.tap('.block[data-id="d1-ano"]');
  await page.tap('#tabMine');
  await page.until(() => document.querySelector('.item[data-id="d1-nell"]'));
  assert.equal(await page.eval(`document.querySelectorAll('#mineIn .rm').length`), 0, 'no × on list items');
  await page.tap('.item[data-id="d1-nell"]');
  await page.until(() => !document.getElementById('lpCard').hidden);
  const card = await page.eval(() => {
    const x = document.querySelector('#lpCard [data-lp="close"]');
    return { name: document.getElementById('lpName').textContent, remove: !!document.querySelector('[data-lp-act="remove"]'), closeVisible: !!x && x.getBoundingClientRect().width > 1 };
  });
  assert.deepEqual(card, { name: 'NELL', remove: true, closeVisible: false });
  await page.tap('[data-lp-act="remove"]');
  await page.until(() => !document.querySelector('.item[data-id="d1-nell"]'));
  assert.equal(await page.eval(`document.getElementById('mineSub').textContent`), '1 團');
  // Tap outside the card closes it.
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: 120, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: 120, button: 'left', clickCount: 1 });
  await page.until(() => document.getElementById('lpCard').hidden);
  await closePage(page);
  await main.close();
});


/* ---------------- megaport2026: map, players, English, the 巧虎 draw ---------------- */
const MP = 'megaport2026';
const mp = loadEvent(MP);

test('megaport: 12 stages, both days, and vagabond keeps no map or language buttons', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${MP}/`, { time: '2026-03-01T12:00:00+08:00' });
  for (const day of [1, 2]) {
    await page.tap(`#day${day}`);
    const n = await page.eval(`[document.querySelectorAll('#grid .sh').length, document.querySelectorAll('#grid .block').length]`);
    assert.deepEqual(n, [12, mp.schedule.filter((x) => x.day === day).length], `day ${day}`);
  }
  assert.equal(await page.eval(`!!document.getElementById('mapBtn') && !!document.getElementById('langBtn')`), true);
  await closePage(page);
  const vb = await open(`${main.base}/${SLUG}/`);
  assert.equal(await vb.eval(`!!document.getElementById('mapBtn') || !!document.getElementById('langBtn')`), false, 'vagabond unchanged: no map, no EN');
  await closePage(vb);
  await main.close();
});

test('megaport map: official images, stage hotspots with what is on and walking directions', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${MP}/`, { time: '2026-03-21T15:00:00+08:00' });
  await page.tap('#mapBtn');
  await page.until(() => { const i = document.getElementById('mvImg'); return i && i.complete && i.naturalWidth > 0 && document.getElementById('mvPan').offsetWidth > 0; });
  const spots = await page.eval(`[...document.querySelectorAll('[data-spot]')].map((b) => b.dataset.spot)`);
  assert.deepEqual(spots.sort(), Object.keys(mp.venue.map.regions).sort(), 'one hotspot per stage on the map');
  await page.tap('[data-spot="SO"]');
  await page.until(() => !document.getElementById('mvPop').hidden);
  const pop = await page.eval(() => ({ text: document.getElementById('mvPop').innerText, go: document.querySelector('.mv-go')?.getAttribute('href') || '' }));
  assert.match(pop.text, /南霸天/);
  assert.match(pop.text, /接下來/, 'festival day: what is next on that stage');
  assert.match(pop.go, /22\.61653,120\.28367/, 'directions to the stage coordinates');
  // An upcoming show in the popup jumps to it on the board.
  await page.tap('#mvPop [data-go]');
  await page.until(() => document.querySelector('.mv').hidden && document.querySelector('.block.located'));
  // The day timetables are plain images, no hotspots.
  await page.tap('#mapBtn');
  await page.tap('[data-mv="1"]');
  await page.until(() => /day_1/.test(document.getElementById('mvImg').getAttribute('src')));
  assert.equal(await page.eval(`document.querySelectorAll('[data-spot]').length`), 0);
  await page.tap('[data-mv-close]');
  await page.until(() => document.querySelector('.mv').hidden);
  await closePage(page);
  await main.close();
});

test('megaport card: players from the streaming IDs, tabs per member, intro kept', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${MP}/`, { time: '2026-03-01T12:00:00+08:00' });
  await page.longPress('.block[data-id="d1-so-1"]');
  await page.until(() => !document.getElementById('lpCard').hidden && document.querySelector('#lpEmbed iframe'));
  await sleep(300); // the card ignores touches for a moment after the long press lifts
  const one = await page.eval(() => ({ src: document.querySelector('#lpEmbed iframe').src, tabs: [...document.querySelectorAll('[data-emb]')].map((b) => b.textContent) }));
  assert.match(one.src, /open\.spotify\.com\/embed\/artist\/4IlxI05VmVDx8ShdgKEnLK/);
  assert.deepEqual(one.tabs, ['Spotify', 'Apple Music', 'YouTube']);
  await page.tap('[data-emb="appleMusic"]');
  assert.match(await page.eval(`document.querySelector('#lpEmbed iframe').src`), /embed\.music\.apple\.com\/tw\/album\//);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.until(() => document.getElementById('lpCard').hidden);
  await page.longPress('.block[data-id="d1-ct-2"]');
  await page.until(() => !document.getElementById('lpCard').hidden);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('[data-lp-tab]')].map((b) => b.textContent)`), ['LAWA', 'Angie安吉']);
  await closePage(page);
  await main.close();
});

test('megaport in English: labels, stage and artist names switch, and it is remembered', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${MP}/`, { time: '2026-03-01T12:00:00+08:00' });
  await page.tap('#langBtn');
  await page.waitFor('Page.loadEventFired').catch(() => {});
  await page.until(() => document.documentElement.lang === 'en' && document.querySelectorAll('#grid .block').length > 0);
  const en = await page.eval(() => ({
    tab: document.querySelector('#tabMine b').textContent,
    stage: document.querySelector('#grid .sh b').textContent,
    block: document.querySelector('.block[data-id="d1-so-1"] .nm').textContent,
    word: document.getElementById('wordmarkText').textContent,
    sub: document.getElementById('topSub').textContent,
    btn: document.getElementById('langBtn').textContent,
  }));
  assert.deepEqual(en, { tab: 'My Schedule', stage: 'SOUTHERN OVERLORD', block: 'The Chairs', word: 'Megaport', sub: 'Mar 21–22 · Kaohsiung Pier-2', btn: '中' });
  await page.reload();
  await page.until(() => document.querySelectorAll('#grid .block').length > 0);
  assert.equal(await page.eval(`document.documentElement.lang`), 'en', 'language is remembered');
  await page.tap('#langBtn');
  await page.until(() => document.documentElement.lang !== 'en' && document.querySelectorAll('#grid .block').length > 0);
  assert.equal(await page.eval(`document.querySelector('#tabMine b').textContent`), '我的團序');
  await closePage(page);
  await main.close();
});

test('megaport lottery: 巧虎 always wins, and drawing again earns a telling-off', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${MP}/`, { time: '2026-03-01T12:00:00+08:00' });
  await page.tap('.block[data-id="d1-kd-1"]');
  await page.tap('.block[data-id="d1-dg-4"]');
  await page.tap('#tabMine');
  await page.until(() => document.querySelector('.cluster .draw'));
  for (let round = 0; round < 3; round++) {
    await page.tap('.cluster .draw');
    await page.tap('[data-act="spin"]');
    await page.until(() => document.querySelector('[data-act="accept"]'), { ms: 15000 });
    const r = await page.eval(`document.getElementById('lotResult').innerText`);
    assert.match(r, /小朋友就是要看[\s\S]*巧虎/, `round ${round}: 巧虎 wins`);
    if (round < 2) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.until(() => document.getElementById('sheet').hidden);
      continue;
    }
    await page.tap('[data-act="spin"]');
    await page.until(() => document.querySelector('.lot-scold'));
    assert.equal(await page.eval(`document.querySelector('.lot-scold').textContent`), '小朋友就是要看巧虎！');
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('#lotActions button')].map((b) => b.textContent)`), ['接受結果']);
    await page.tap('[data-act="accept"]');
  }
  assert.equal(await page.eval(`document.querySelector('.go-tag') && document.querySelector('.go-tag').closest('.item').dataset.id`), 'd1-kd-1');
  await closePage(page);
  await main.close();
});

test('megaport: nothing clipped at 390 and 320 px, in Chinese and English; only own-origin requests on load', { skip: SKIP }, async () => {
  const main = await origin();
  for (const width of [390, 320]) {
    for (const lng of ['zh', 'en']) {
      const page = await chrome.newPage({ width, height: 844 });
      const urls = [];
      chrome.conn.listeners.add((m) => { if (m.sessionId === page.sessionId && m.method === 'Network.requestWillBeSent') urls.push(m.params.request.url); });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('fp:${MP}:lang', '${lng}'); } catch (e) {}` });
      await page.goto(`${main.base}/${MP}/`);
      await page.until(() => document.querySelectorAll('#grid .block').length > 0);
      await page.eval('document.fonts.ready');
      const found = [];
      for (const d of [1, 2]) {
        await page.tap(`#day${d}`);
        await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
        found.push(...await page.eval(CLIPPED));
      }
      await page.tap('.block[data-id="d2-dx-1"]');
      await page.tap('#tabMine');
      await page.until(() => document.getElementById('aboutBtn'));
      found.push(...await page.eval(CLIPPED));
      assert.deepEqual([...new Set(found)], [], `clipped at ${width}px (${lng})`);
      const foreign = foreignOf(urls, main.base);
      assert.deepEqual(foreign, [], `third-party requests (${lng})`);
      await closePage(page);
    }
  }
  await main.close();
});


/* ---------------- homepage: chiparashi.tw/ lists the events ---------------- */
const HOME_READY = () => document.querySelectorAll('.ticket').length > 0;
// Tickets in page order (coming up, then the finished stubs), each with what its stub says.
const homeCards = () => [...document.querySelectorAll('.ticket')].map((a) => [a.getAttribute('href'), [...a.querySelectorAll('.t-k, .t-n, .t-u')].map((x) => x.textContent).filter(Boolean).join(' ')]);

test('homepage: upcoming events first with a countdown, today on festival days, ended ones last; a card opens the event', { skip: SKIP }, async () => {
  const main = await origin();
  const at = async (time, timezone) => { const p = await open(`${main.base}/`, { time, timezone, ready: HOME_READY }); const c = await p.eval(homeCards); await closePage(p); return c; };
  // Dated events coming up first (soonest first), then the ones waiting for dates, then the ones that are over.
  const TBA = ['megaport2027/', '日期待公布'];
  assert.deepEqual(await at('2026-10-18T12:00:00+08:00'), [['vagabond2026/', '還有 20 天'], TBA, ['megaport2026/', '已結束']]);
  assert.deepEqual(await at('2026-11-06T09:00:00+08:00'), [['vagabond2026/', '明天 開始'], TBA, ['megaport2026/', '已結束']]);
  // 23:30 on day 1 in Tainan, seen from a phone set to New York time (still the 7th in Taipei).
  assert.deepEqual(await at('2026-11-07T23:30:00+08:00', 'America/New_York'), [['vagabond2026/', '今天 DAY 1 進行中'], TBA, ['megaport2026/', '已結束']]);
  assert.deepEqual(await at('2026-11-09T09:00:00+08:00'), [TBA, ['vagabond2026/', '已結束'], ['megaport2026/', '已結束']], 'most recent first');
  assert.deepEqual(await at('2026-03-01T12:00:00+08:00'), [['megaport2026/', '還有 20 天'], ['vagabond2026/', '還有 251 天'], TBA], 'soonest first');
  const page = await open(`${main.base}/`, { ready: HOME_READY });
  await page.tap('.ticket[href="vagabond2026/"]');
  await page.until(() => location.pathname === '/vagabond2026/' && document.querySelectorAll('#grid .block').length > 0);
  await closePage(page);
  await main.close();
});

test('homepage: theme switch top-right, nothing clipped, no arrows or 前往, only own-origin requests', { skip: SKIP }, async () => {
  const main = await origin();
  for (const width of [390, 320]) {
    const page = await chrome.newPage({ width, height: 844 });
    const urls = [];
    chrome.conn.listeners.add((m) => { if (m.sessionId === page.sessionId && m.method === 'Network.requestWillBeSent') urls.push(m.params.request.url); });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await page.goto(`${main.base}/`);
    await page.until(HOME_READY);
    await page.until(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const found = await page.eval(() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.offsetParent === null || el.tagName === 'SCRIPT') continue;
        const cs = getComputedStyle(el);
        const hides = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
        if (hides && el.children.length === 0 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(el.textContent.trim().slice(0, 20));
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1) out.push(`overflows: ${el.className || el.tagName}`);
      }
      return out;
    });
    assert.deepEqual(found, [], `clipped at ${width}px`);
    assert.doesNotMatch(await page.eval('document.body.innerText'), /前往|→|›|»/);
    const btn = await page.eval(() => { const r = document.getElementById('themeBtn').getBoundingClientRect(); return { right: innerWidth - r.right < 40, top: r.top < 80, label: document.getElementById('themeBtn').getAttribute('aria-label') }; });
    assert.deepEqual(btn, { right: true, top: true, label: '切換成淺色模式' });
    await page.tap('#themeBtn');
    assert.equal(await page.eval(`document.documentElement.dataset.theme + '|' + getComputedStyle(document.body).backgroundColor`), 'light|rgb(241, 238, 236)');
    await page.reload();
    await page.until(HOME_READY);
    assert.equal(await page.eval('document.documentElement.dataset.theme'), 'light', 'remembered');
    await page.tap('#themeBtn');
    assert.equal(await page.eval(`localStorage.getItem('fp:home:theme')`), null, 'back to the system theme forgets the choice');
    const foreign = foreignOf(urls, main.base);
    assert.deepEqual(foreign, []);
    await closePage(page);
  }
  await main.close();
});

test('vagabond card: one recommended song per platform, each tab its own song', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  await page.send('Network.setBlockedURLs', { urls: PLAYER_HOSTS });
  const a = artists['拍謝少年'];
  const show = schedule.find((s) => s.name.split(/\s+(?:ft\.|×)\s+/)[0] === '拍謝少年'); // 拍謝少年 ft. 謝銘祐: first tab
  await page.tap(`#day${show.day}`);
  await page.longPress(`.block[data-id="${show.id}"]`);
  await page.until(() => !document.getElementById('lpCard').hidden && document.querySelector('#lpEmbed iframe'));
  await sleep(300); // the card ignores touches for a moment after the long press lifts
  const srcs = [];
  for (const k of ['spotifyTrack', 'appleMusicSong', 'youtube']) {
    await page.tap(`[data-emb="${k}"]`);
    srcs.push(await page.eval(`document.querySelector('#lpEmbed iframe').getAttribute('src')`));
  }
  const [album, song] = a.embeds.appleMusicSong.split('?i=');
  assert.match(srcs[0], new RegExp(`^https://open\\.spotify\\.com/embed/track/${a.embeds.spotifyTrack}\\?`));
  assert.match(srcs[1], new RegExp(`^https://embed\\.music\\.apple\\.com/tw/album/${album}\\?i=${song}&`));
  assert.equal(srcs[2], `https://www.youtube-nocookie.com/embed/${a.embeds.youtube}`);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#lpPlat a')].length`), 0, 'every platform has a song, so no link buttons');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.until(() => document.getElementById('lpCard').hidden);
  await closePage(page);
  await main.close();
});

/* ---------------- pages that read without JavaScript (features.pages) ---------------- */
const NOJS_CLIPPED = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.offsetParent === null || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1) out.push(`wider than the screen: ${el.tagName}.${el.className}`);
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || (el.children.length === 0 && cs.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1)) out.push(`cut off: ${el.textContent.trim().slice(0, 20)}`);
  }
  return out;
};

test('without JavaScript: the timetable, an artist page and the Claude page read fine at phone width', { skip: SKIP }, async () => {
  const main = await origin();
  for (const width of [390, 320]) {
    const page = await chrome.newPage({ width, height: 844 });
    await page.send('Emulation.setScriptExecutionDisabled', { value: true });
    await page.goto(`${main.base}/${SLUG}/`);
    const app = await page.eval(() => ({
      nojs: document.documentElement.classList.contains('nojs'),
      list: getComputedStyle(document.getElementById('static')).display,
      rows: document.querySelectorAll('#static li').length,
      board: getComputedStyle(document.getElementById('pickView')).display,
      dock: getComputedStyle(document.getElementById('dock')).display,
    }));
    assert.deepEqual(app, { nojs: true, list: 'block', rows: schedule.length, board: 'none', dock: 'none' });
    assert.deepEqual(await page.eval(NOJS_CLIPPED), [], `timetable at ${width}px`);
    for (const p of [`artists/${artists['拍謝少年'].slug}/`, 'claude/']) {
      await page.goto(`${main.base}/${SLUG}/${p}`);
      assert.ok(await page.eval(`document.querySelector('h1').textContent.length > 0 && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'`), p);
      assert.deepEqual(await page.eval(NOJS_CLIPPED), [], `${p} at ${width}px`);
    }
    await closePage(page);
  }
  await main.close();
});

test('with JavaScript: the text timetable stays hidden, the board says where the data is from, #show- opens on that show', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await open(`${main.base}/${SLUG}/`);
  const st = await page.eval(() => ({
    nojs: document.documentElement.classList.contains('nojs'),
    list: getComputedStyle(document.getElementById('static')).display,
    note: document.querySelector('#board .board-note')?.textContent || '',
  }));
  assert.equal(st.nojs, false);
  assert.equal(st.list, 'none');
  assert.match(st.note, /官方公告 2026\/10\/17・非官方排團工具/);
  await closePage(page);
  // From an artist page's 在時間表上看: day 2, the show on screen, and the address loses the #show- part.
  const target = schedule.find((s) => s.day === 2 && s.stage === EV.stages.at(-1).id);
  const p2 = await open(`${main.base}/${SLUG}/#show-${target.id}`);
  await p2.until((id) => {
    const b = document.querySelector(`.block[data-id="${id}"]`);
    if (!b || document.getElementById('day2').getAttribute('aria-pressed') !== 'true') return false;
    const r = b.getBoundingClientRect(); const br = document.getElementById('board').getBoundingClientRect();
    return r.left >= br.left && r.right <= br.right + 1 && r.top >= br.top && r.bottom <= br.bottom;
  }, { args: [target.id], ms: 4000 });
  assert.equal(await p2.eval('location.hash'), '');
  await closePage(p2);
  await main.close();
});

test('the service worker leaves the other pages alone: an artist page opens as itself, with its Markdown copy in the headers', { skip: SKIP }, async () => {
  const main = await origin();
  const page = await chrome.newPage();
  await page.goto(`${main.base}/${SLUG}/`);
  await page.until(() => navigator.serviceWorker.controller !== null, { ms: 10000 });
  const slug = artists['拍謝少年'].slug;
  await page.goto(`${main.base}/${SLUG}/artists/${slug}/`);
  assert.equal(await page.eval(`document.querySelector('h1').textContent`), '拍謝少年');
  assert.equal(await page.eval(`!!document.getElementById('grid')`), false, 'not the app');
  const r = await fetch(`${main.base}/${SLUG}/artists/${slug}/`);
  assert.equal(r.headers.get('link'), '<index.md>; rel="alternate"; type="text/markdown"');
  const m = await fetch(`${main.base}/${SLUG}/artists/${slug}/index.md`);
  assert.match(m.headers.get('content-type'), /^text\/markdown/);
  assert.match(await m.text(), /^# 拍謝少年/);
  await closePage(page);
  await main.close();
});

test('an event waiting for its announcement: one page saying so, readable at 390 and 320 px, nothing from other sites', { skip: SKIP }, async () => {
  const main = await origin();
  for (const [width, theme] of [[390, 'dark'], [320, 'light']]) {
    const page = await chrome.newPage({ width, height: 844 });
    const urls = [];
    chrome.conn.listeners.add((m) => { if (m.sessionId === page.sessionId && m.method === 'Network.requestWillBeSent') urls.push(m.params.request.url); });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await page.goto(`${main.base}/megaport2027`);
    assert.equal(await page.eval('location.pathname'), '/megaport2027/');
    assert.match(await page.eval('document.body.innerText'), /待官方資訊公布/);
    assert.deepEqual(await page.eval(NOJS_CLIPPED), [], `clipped at ${width}px`);
    assert.equal(await page.eval('navigator.serviceWorker.controller'), null);
    assert.deepEqual(foreignOf(urls, main.base), []);
    await closePage(page);
  }
  await main.close();
});
