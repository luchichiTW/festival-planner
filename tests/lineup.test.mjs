// An event whose lineup is out but not its timetable (event.json "status": "lineup"): one page listing the acts in the
// festival's own order, readable without JavaScript, where a tap or a long press opens the artist card with the
// links the festival lists for that act. It becomes the full planner once the official timetable is out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, loadEvent, validate } from '../scripts/validate.mjs';
import { build, buildSite } from '../scripts/build.mjs';

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

test('a lineup event builds one page: every act in the HTML in the festival’s order, no service worker, no single file', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-lineup-'));
  process.env.FP_BUILD = 'lineup-test';
  try { build(SLUG, { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  const site = path.join(out, SLUG);
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const { event: ev, lineup, artists } = loadEvent(SLUG);
  // Readable without JavaScript: the names are in the page itself, in order, with the English name where there is one.
  const tiles = [...html.matchAll(/<button type="button" class="lu-tile" data-i="(\d+)"[^>]*><b>([^<]*)<\/b>(?:<i>([^<]*)<\/i>)?<\/button>/g)];
  assert.deepEqual(tiles.map((m) => unesc(m[2])), lineup.map((a) => a.name));
  assert.deepEqual(tiles.map((m) => (m[3] ? unesc(m[3]) : '')), lineup.map((a) => a.en || ''));
  // Title and description: the lineup, how many acts, as of when.
  const title = unesc(/<title>([^<]*)<\/title>/.exec(html)[1]);
  assert.ok(title.includes(ev.name) && title.includes('陣容'), title);
  const desc = unesc(/<meta name="description" content="([^"]*)">/.exec(html)[1]);
  assert.ok(desc.includes(`已公布 ${lineup.length} 組`), desc);
  assert.ok(desc.includes(slash(ev.dataDate)), 'data date in the description');
  assert.ok(desc.includes(lineup[0].name), 'names the first acts');
  assert.match(html, new RegExp(`<link rel="canonical" href="${ev.urls.site}">`));
  assert.match(html, /<html lang="zh-Hant-TW"/);
  // No offline install yet, no event data until the dates are official, nothing from other sites.
  assert.doesNotMatch(html, /sw\.js|serviceWorker/);
  assert.equal(fs.existsSync(path.join(site, 'sw.js')), false);
  assert.doesNotMatch(html, /application\/ld\+json/, 'no structured data until the dates are official');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="https?:\/\/(?!chiparashi)|<img[^>]+src="https?:/, 'nothing loaded from other sites');
  assert.doesNotMatch(html, /wp-content/, 'no pictures from the festival site');
  assert.ok(html.includes('href="/privacy/"'), 'privacy page');
  assert.ok(html.includes(`id="lpCard"`), 'the artist card');
  // What the card needs: each act's links, and an intro in our own words where there is one.
  const data = JSON.parse(/window\.FP_LINEUP = (.*);\n/.exec(html)[1]);
  assert.deepEqual(data.acts.map((a) => a.name), lineup.map((a) => a.name));
  assert.deepEqual(data.acts.map((a) => a.links), lineup.map((a) => a.links));
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
