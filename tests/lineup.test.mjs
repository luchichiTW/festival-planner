// An event whose lineup is out but not its timetable (event.json "status": "lineup"): one page listing the acts in the
// festival's own order, readable without JavaScript, where a tap or a long press opens the artist card with the
// links the festival lists for that act. It becomes the full planner once the official timetable is out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, loadEvent, validate, lineupId, lineupSets } from '../scripts/validate.mjs';
import { build, buildEvent, buildSite } from '../scripts/build.mjs';
import { plannerWithLineup } from './helpers.mjs';

const SLUG = 'megaport2027';
const HOST = 'https://chiparashi.tw';
const clone = (o) => JSON.parse(JSON.stringify(o));
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const slash = (iso) => iso.split('-').map(Number).join('/');

test('a lineup event validates with its acts and no timetable', () => {
  const ev = loadEvent(SLUG);
  assert.equal(ev.event.status, 'lineup');
  assert.ok(ev.lineup.length > 0);
  assert.deepEqual(ev.schedule, []);
  assert.deepEqual(validate(ev).errors, []);
  const errs = (change) => { const c = clone(ev); change(c); return validate(c).errors; };
  assert.ok(errs((c) => { c.lineup = []; }).some((e) => /lineup/.test(e)), 'at least one act');
  assert.ok(errs((c) => { c.lineup.push(clone(c.lineup[0])); }).some((e) => /重複/.test(e)), 'no act twice');
  assert.ok(errs((c) => { delete c.lineup[0].name; }).some((e) => /name/.test(e)));
  assert.ok(errs((c) => { c.lineup[1].links.official = 'http://example.com/'; }).some((e) => /https/.test(e)), 'links are https');
  assert.ok(errs((c) => { c.lineup[1].links.spotify = 'https://open.spotify.com/artist/x'; }).some((e) => /spotify/.test(e)), 'only the kinds of link the festival lists');
  assert.ok(errs((c) => { c.lineup[1].page = 'https://example.com/the-hu/'; }).some((e) => /page/.test(e)), 'page is the act on the festival site');
  assert.ok(errs((c) => { c.lineup[2].page = c.lineup[1].page; }).some((e) => /page/.test(e) && /重複/.test(e)), 'one page per act (its id for 想看)');
  // The card on top: a past event's real timetable to try, with that event's pictures of its board.
  assert.ok(errs((c) => { c.event.demo = 'nope'; }).some((e) => /demo/.test(e)), 'demo is an event in events/');
  assert.ok(errs((c) => { c.event.demo = 'megaport2027'; }).some((e) => /demo/.test(e)), 'demo is a planner, not another lineup page');
  assert.ok(errs((c) => { c.event.demo = 'megaport2026'; }).some((e) => /board-light\.webp|board-dark\.webp/.test(e)), 'demo needs the board pictures');
  assert.ok(errs((c) => { c.schedule = loadEvent('megaport2026').schedule.slice(0, 1); }).some((e) => /lineup/.test(e)), 'a timetable means it is not lineup any more');
  assert.ok(errs((c) => { delete c.event.dataDate; }).some((e) => /dataDate/.test(e)), 'as of when');
  // Intros: own words, from the act's own website only (the official link the festival lists).
  const withOfficial = ev.lineup.find((a) => a.links.official);
  const site = new URL(withOfficial.links.official).hostname;
  assert.ok(errs((c) => { c.artists[withOfficial.name] = { bio: '一句介紹。', sources: [] }; }).some((e) => /來源/.test(e)), 'an intro needs its source');
  assert.ok(errs((c) => { c.artists[withOfficial.name] = { bio: '一句介紹。', sources: ['https://en.wikipedia.org/wiki/X'] }; }).some((e) => /官方網站/.test(e)), 'and the source is the act’s own site');
  assert.deepEqual(errs((c) => { c.artists[withOfficial.name] = { bio: '一句介紹。', sources: [`https://${site}/profile/`] }; }), []);
  const noSite = ev.lineup.find((a) => !a.links.official);
  if (noSite) assert.ok(errs((c) => { c.artists[noSite.name] = { bio: '一句介紹。', sources: ['https://example.com/'] }; }).some((e) => /官方網站/.test(e)), 'no official site, no intro');
  const stray = clone(ev);
  stray.artists.Nobody = { bio: '', sources: [] };
  assert.ok(validate(stray).warnings.some((w) => /Nobody/.test(w)), 'an intro for an act not in the lineup');
});

test('a lineup event builds one page: every act in the HTML in the festival’s order, offline like the planner, no single file', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-lineup-'));
  process.env.FP_BUILD = 'lineup-test';
  try { build(SLUG, { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  const site = path.join(out, SLUG);
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const { event: ev, lineup, artists } = loadEvent(SLUG);
  // Readable without JavaScript: the names are in the page itself, in order, with the English name where there is one.
  const tiles = [...html.matchAll(/<li class="lu-tile" data-i="(\d+)"><button type="button" class="lu-open"[^>]*><b>([^<]*)<\/b>(?:<i>([^<]*)<\/i>)?<\/button>(<button type="button" class="lu-want"[^>]*>[\s\S]*?<\/button>)<\/li>/g)];
  assert.deepEqual(tiles.map((m) => unesc(m[2])), lineup.map((a) => a.name));
  assert.deepEqual(tiles.map((m) => (m[3] ? unesc(m[3]) : '')), lineup.map((a) => a.en || ''));
  // 想看: one button per act, shown by the script (without JavaScript there is nothing to mark), off to start with.
  for (const m of tiles) {
    assert.match(m[4], /aria-pressed="false"/);
    assert.match(m[4], / hidden[ >]/);
    assert.match(m[4], new RegExp(`aria-label="想看：${m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  // The card on top says what the page becomes, in the page itself (readable without JavaScript), and links the
  // demo event's real timetable. The 想看 line sits right above the acts.
  const demo = /<section class="lu-demo"[\s\S]*?<\/section>/.exec(html)?.[0] || '';
  for (const line of ['時間表公布後可以這樣用', '看各舞台的時間表', '排自己的團序，撞團時抽籤', '加到主畫面，沒網路也能看', '已結束的活動，時間表是真的']) assert.ok(demo.includes(line), line);
  const demoEv = loadEvent(ev.demo).event;
  assert.match(demo, new RegExp(`<a class="lu-demo-btn" id="luDemoBtn" href="/${ev.demo}/\\?try">用${demoEv.name}${/[A-Za-z0-9]$/.test(demoEv.name) ? " " : ""}試玩</a>`));
  for (const theme of ['light', 'dark']) {
    const img = new RegExp(`<img class="lu-shot-${theme}" src="demo-${theme}\\.webp" width="(\\d+)" height="(\\d+)" alt="${demoEv.name} 排團工具的時間表畫面"`).exec(demo);
    assert.ok(img, `${theme} picture`);
    const file = fs.readFileSync(path.join(site, `demo-${theme}.webp`));
    assert.equal(file.toString('latin1', 0, 4) + file.toString('latin1', 8, 12), 'RIFFWEBP', `${theme} picture is WebP`);
    assert.ok(file.length < 60 * 1024, `${theme} picture is small (${file.length} bytes)`);
    assert.ok(Number(img[2]) > Number(img[1]), 'a phone-shaped picture');
  }
  assert.ok(html.indexOf('class="lu-demo"') < html.indexOf('id="luGrid"'), 'the card comes before the acts');
  assert.match(html, /<p class="lu-intro" id="luIntro" hidden>先標想看的團，時間表公布後會自動排進團序。<\/p>\s*<ul class="lu-grid"/);
  assert.doesNotMatch(html, /這裡會變成排團工具。<\/p>/, 'the card replaces the old line');
  assert.match(html, /<div class="lu-dock" id="luDock"><p class="lu-bar" id="luBar" role="status" hidden><\/p><\/div>/, 'the 想看 count sits at the bottom (no search: a short lineup)');
  // Title and description: the lineup, how many acts, as of when.
  const title = unesc(/<title>([^<]*)<\/title>/.exec(html)[1]);
  assert.ok(title.includes(ev.name) && title.includes('陣容'), title);
  const desc = unesc(/<meta name="description" content="([^"]*)">/.exec(html)[1]);
  assert.ok(desc.includes(`已公布 ${lineup.length} 組`), desc);
  assert.ok(desc.includes(slash(ev.dataDate)), 'data date in the description');
  assert.ok(desc.includes(lineup[0].name), 'names the first acts');
  assert.match(html, new RegExp(`<link rel="canonical" href="${ev.urls.site}">`));
  assert.match(html, /<html lang="zh-Hant-TW"/);
  // Offline like the planner: the same service worker, its own cache, every file the page shows (the planner that
  // replaces the page later takes over the same sw.js and clears this cache). No event data until the dates are
  // official, nothing from other sites.
  assert.match(html, /\.register\('sw\.js'\)/);
  const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  assert.match(sw, /const VERSION = "lineup-test";/);
  assert.match(sw, /const CACHE = "fp-megaport2027-lineup-test";/);
  assert.match(sw, /const PREFIX = "fp-megaport2027-";/);
  const files = JSON.parse(/const FILES = (.*);\n/.exec(sw)[1]);
  const shown = fs.readdirSync(site, { recursive: true }).filter((f) => fs.statSync(path.join(site, f)).isFile() && f !== 'index.html' && f !== 'sw.js');
  assert.deepEqual(files.filter((f) => f !== './').sort(), shown.map((f) => f.split(path.sep).join('/')).sort(), 'every file of the page is cached');
  assert.ok(files.includes('./'));
  assert.doesNotMatch(html, /application\/ld\+json/, 'no structured data until the dates are official');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="https?:\/\/(?!chiparashi)|<img[^>]+src="https?:/, 'nothing loaded from other sites');
  assert.doesNotMatch(html, /wp-content/, 'no pictures from the festival site');
  assert.ok(html.includes('href="/privacy/"'), 'privacy page');
  assert.match(html, /<footer class="lu-foot">[\s\S]*<p id="luDisclaimer">這是非官方的排團工具。<\/p>[\s\S]*<\/footer>/, 'the footer says it is not the festival’s own');
  assert.ok(html.includes(`id="lpCard"`), 'the artist card');
  // What the card needs: each act's links, and an intro in our own words where there is one.
  const data = JSON.parse(/window\.FP_LINEUP = (.*);\n/.exec(html)[1]);
  assert.deepEqual(data.acts.map((a) => a.name), lineup.map((a) => a.name));
  assert.deepEqual(data.acts.map((a) => a.links), lineup.map((a) => a.links));
  assert.deepEqual(data.acts.map((a) => a.id), lineup.map((a) => lineupId(a.page)), 'each act carries its id for 想看');
  assert.deepEqual(data.demo, { slug: ev.demo, name: demoEv.name, nameEn: demoEv.nameEn });
  // It can go on the Home Screen as the same app the planner will be (marks made there stay there), and on an iPhone
  // the card shows Safari's five steps as pictures (core/a2hs.js, shared with the planner's walkthrough).
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const man = JSON.parse(fs.readFileSync(path.join(site, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual([man.id, man.start_url, man.scope, man.display, man.name], ['./', './', './', 'standalone', ev.name], 'the planner’s manifest');
  assert.deepEqual(data.iosInstallSteps, [1, 2, 3, 4, 5].map((i) => `a2hs/step${i}.webp`));
  assert.deepEqual(data.iosInstallStepsBefore27, [1, 2, 3, 4, 5].map((i) => `a2hs/step${i}-ios26.webp`));
  for (const f of [...data.iosInstallSteps, ...data.iosInstallStepsBefore27]) assert.ok(fs.existsSync(path.join(site, f)), f);
  assert.match(html, /window\.FP_A2HS = /, 'the shared add-to-Home-Screen helpers are in the page');
  for (const a of data.acts) assert.equal(a.bio || '', artists[a.name]?.bio || '', `${a.name} intro`);
  assert.match(fs.readFileSync(path.join(out, '_redirects'), 'utf8'), new RegExp(`^/${SLUG} /${SLUG}/ 301$`, 'm'));
  assert.equal(fs.existsSync(path.join(out + '-art', SLUG)), false, 'no single-file artifact without a timetable');
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(out + '-art', { recursive: true, force: true });
});

test('the homepage, llms.txt and the sitemap say how many acts are out, and as of when', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-lineup-site-'));
  buildSite({ out });
  const { event: ev, lineup } = loadEvent(SLUG);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const t = new RegExp(`<a class="ticket"[^>]* href="${SLUG}/"[\\s\\S]*?</a>`).exec(html)?.[0] || '';
  assert.ok(t.includes("data-days='[]'"), 'no dates yet');
  assert.match(t, new RegExp(`<p class="t-where">已公布 ${lineup.length} 組陣容・每年更新</p>`));
  const line = fs.readFileSync(path.join(out, 'llms.txt'), 'utf8').split('\n').find((l) => l.includes(`(${HOST}/${SLUG}/)`));
  assert.ok(line.includes(`已公布 ${lineup.length} 組陣容（${slash(ev.dataDate)}）`), line);
  assert.ok(line.includes('時間表待公布') && line.includes(ev.subtitle), line);
  assert.ok(fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8').includes(`<loc>${HOST}/${SLUG}/</loc><lastmod>${ev.dataDate}</lastmod>`));
  fs.rmSync(out, { recursive: true, force: true });
});

test('every line of the lineup page has its English version in core/i18n.js', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'core', 'i18n.js'), 'utf8'), ctx);
  const en = ctx.window.FP_I18N.en;
  const src = fs.readFileSync(path.join(ROOT, 'core', 'lineup.js'), 'utf8');
  const keys = [...src.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 5);
  assert.deepEqual(keys.filter((k) => !en[k]), []);
});

test('an act’s id is the last part of its page address on the festival site: it stays when the name is written differently', () => {
  assert.equal(lineupId('https://megaportfest.com/portfolio-item/the-hu/'), 'the-hu');
  assert.equal(lineupId('https://megaportfest.com/portfolio-item/%e6%b4%aa%e6%a6%ae%e5%ae%8f/'), '洪榮宏');
  assert.equal(lineupId('https://megaportfest.com/portfolio-item/SiM'), 'sim');
  const ids = loadEvent(SLUG).lineup.map((a) => lineupId(a.page));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Boolean));
});

test('after the timetable: each act on the lineup finds its sets, by name, English name or a "lineup" id on the set', () => {
  const { e, ids } = plannerWithLineup();
  assert.deepEqual(validate(e).errors, []);
  const map = lineupSets(e.lineup, e.schedule);
  assert.deepEqual(map['fire-ex'], [ids.fire]);
  assert.deepEqual(map.tagged, [ids.tagged], '"[JP]" and the like don’t count');
  assert.deepEqual(map.linked, [ids.linked]);
  const lost = clone(e);
  lost.lineup.push({ name: '沒有出現的團', page: 'https://megaportfest.com/portfolio-item/gone/', links: {} });
  assert.ok(validate(lost).errors.some((m) => /沒有出現的團/.test(m) && /lineup/.test(m)), 'an act with no set is an error (its 想看 would be lost)');
  const stray = clone(e);
  stray.schedule[0] = { ...stray.schedule[0], lineup: 'nobody' };
  assert.ok(validate(stray).errors.some((m) => /nobody/.test(m)), 'a set’s lineup id is an act on the lineup');
  // The planner gets the map (website only: the single file never had the lineup page's marks).
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-want-'));
  process.env.FP_BUILD = 'want-test';
  try { buildEvent(e, { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  const evt = (file) => { const ctx = { window: {} }; vm.runInNewContext(/window\.FP_EVENT = .*;\n/.exec(fs.readFileSync(file, 'utf8'))[0], ctx); return ctx.window.FP_EVENT; };
  const site = fs.readdirSync(path.join(out, e.slug)).find((f) => /^data.*\.js$/.test(f));
  assert.deepEqual(JSON.parse(JSON.stringify(evt(path.join(out, e.slug, site)).wants)), map);
  assert.equal(evt(path.join(out + '-art', e.slug, 'index.html')).wants, undefined);
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(out + '-art', { recursive: true, force: true });
});
