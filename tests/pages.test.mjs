// Pages that read without JavaScript (features.pages): the timetable as text, one page per artist with data, the
// "make your own with Claude" page, and what goes with them (metadata, structured data, sitemap, Markdown copies).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEvent, validate } from '../scripts/validate.mjs';
import { build } from '../scripts/build.mjs';
import { claudePrompt } from '../scripts/lib/pages.mjs';
import { ROOT } from '../scripts/validate.mjs';

const SLUG = 'vagabond2026';
const { event: EV, schedule, artists } = loadEvent(SLUG);
const BASE = EV.urls.site; // https://chiparashi.tw/vagabond2026/
const withData = Object.entries(artists).filter(([, a]) => a.bio || Object.keys(a.links || {}).length);
const clone = (o) => JSON.parse(JSON.stringify(o));

let out;
let site;
before(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-pages-'));
  process.env.FP_BUILD = 'pages-test';
  try { build(SLUG, { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  site = path.join(out, SLUG);
});
after(() => { fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(out + '-art', { recursive: true, force: true }); });
const read = (rel) => fs.readFileSync(path.join(site, rel), 'utf8');
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const meta = (html, attr, key) => new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html)?.[1];
const link = (html, rel) => new RegExp(`<link rel="${rel}"[^>]* href="([^"]*)"`).exec(html)?.[1];
const pages = () => ['', 'claude/', ...withData.map(([, a]) => `artists/${a.slug}/`)];

test('validate: pages need the organizer, the venue and a unique web name for every artist with data', () => {
  const base = () => clone(loadEvent(SLUG));
  assert.deepEqual(validate(base()).errors, []);
  const cases = [
    ['no organizer', (e) => { delete e.event.organizer; }, /organizer/],
    ['no venue', (e) => { delete e.event.venue; }, /venue/],
    ['artist without a web name', (e) => { delete e.artists[withData[0][0]].slug; }, /slug/],
    ['bad web name', (e) => { e.artists[withData[0][0]].slug = 'Sorry Youth'; }, /slug "Sorry Youth"/],
    ['same web name twice', (e) => { e.artists[withData[1][0]].slug = e.artists[withData[0][0]].slug; }, /重複/],
  ];
  for (const [name, breakIt, expected] of cases) {
    const ev = base();
    breakIt(ev);
    const { errors } = validate(ev);
    assert.ok(errors.some((e) => expected.test(e)), `${name}: expected ${expected}, got ${JSON.stringify(errors)}`);
  }
});

test('the timetable page carries both days as text, every show with time, stage and a link to the artist', () => {
  const html = read('index.html');
  const block = /<section class="static"[\s\S]*?<\/section>\s*<!-- \/static -->/.exec(html)?.[0] || '';
  assert.ok(block, 'a text timetable inside the page');
  for (const d of EV.days) assert.ok(block.includes(d.label), d.label);
  const text = block.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'); // names in a billing are separate links
  for (const s of schedule) {
    assert.ok(text.includes(`${s.start}–${s.end}`), `${s.id} time`);
    assert.ok(text.includes(s.name), `${s.id} name`);
  }
  for (const [, a] of withData) assert.ok(block.includes(`href="artists/${a.slug}/"`), `${a.slug} linked`);
  assert.match(html, /<html lang="zh-Hant-TW"/);
});

test('one page per artist with data, none for the rest; each with intro, shows, sources and links', () => {
  const dirs = fs.readdirSync(path.join(site, 'artists')).sort();
  assert.deepEqual(dirs, withData.map(([, a]) => a.slug).sort());
  for (const [name, a] of withData) {
    const html = read(`artists/${a.slug}/index.html`);
    assert.match(html, new RegExp(`<h1[^>]*>${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}</h1>`), `${name} heading`);
    if (a.bio) assert.ok(html.includes(a.bio.split('\n')[0].replace(/&/g, '&amp;').slice(0, 20)), `${name} intro`);
    for (const u of Object.values(a.links || {})) assert.ok(html.includes(`href="${u}"`), `${name} link ${u}`);
    const shows = schedule.filter((s) => s.name === name || s.name.split(/\s+(?:ft\.|×)\s+/).includes(name));
    for (const s of shows) assert.ok(html.includes(`href="../../#show-${s.id}"`), `${name} → ${s.id} on the timetable`);
    for (const p of Object.values(a.picks || {})) assert.ok(html.includes(p.title.replace(/&/g, '&amp;')), `${name} pick ${p.title}`);
    assert.doesNotMatch(html, /<iframe/, 'no third-party players on load');
  }
});

test('every page has its own title, description, canonical, language, preview image, update date and Markdown copy', () => {
  const titles = new Set();
  for (const p of pages()) {
    const html = read(`${p}index.html`);
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
    assert.ok(title && !titles.has(title), `${p}: unique title`);
    titles.add(title);
    assert.ok(meta(html, 'name', 'description')?.length > 20, `${p}: description`);
    assert.equal(link(html, 'canonical'), BASE + p, `${p}: canonical`);
    assert.equal(meta(html, 'property', 'og:url'), BASE + p);
    assert.equal(meta(html, 'property', 'og:image'), BASE + 'og.png');
    assert.ok(fs.existsSync(path.join(site, 'og.png')), 'preview image ships');
    assert.match(html, /<html lang="zh-Hant-TW"/);
    assert.ok(html.includes('2026/10/17'), `${p}: visible data date`);
    assert.ok(html.includes('非官方'), `${p}: says it is unofficial`);
    assert.equal(link(html, 'alternate" type="text/markdown'), 'index.md', `${p}: points to its Markdown copy`);
    const md = read(`${p}index.md`);
    assert.match(md, /^# /, `${p}: Markdown starts with a heading`);
    assert.ok(md.includes('非官方'), `${p}: Markdown says it is unofficial`);
  }
});

test('structured data: the festival, its organizer and venue, and every show with time zone, stage and performers', () => {
  const graph = jsonLd(read('index.html')).flatMap((j) => j['@graph'] || [j]);
  const fest = graph.find((n) => n['@type'] === 'Festival');
  assert.ok(fest, 'a Festival');
  assert.equal(fest.organizer.name, EV.organizer.name);
  assert.equal(fest.location.name, EV.venue.name);
  assert.equal(fest.startDate, EV.days[0].date);
  assert.equal(fest.endDate, EV.days.at(-1).date);
  assert.equal(fest.subEvent.length, schedule.length);
  const page = graph.find((n) => n['@type'] === 'WebPage');
  assert.match(page.description, /非官方/);
  assert.equal(page.dateModified, EV.dataDate);
  for (const s of schedule) {
    const e = fest.subEvent.find((x) => x.identifier === s.id);
    assert.ok(e, s.id);
    assert.equal(e['@type'], s.note ? 'Event' : 'MusicEvent');
    const date = EV.days[s.day - 1].date;
    assert.equal(e.startDate, `${date}T${s.start}:00+08:00`);
    assert.equal(e.endDate, `${date}T${s.end}:00+08:00`);
    for (const p of e.performer || []) {
      const a = artists[p.name];
      if (a?.slug && (a.bio || Object.keys(a.links || {}).length)) assert.equal(p.url, `${BASE}artists/${a.slug}/`);
      assert.deepEqual(p.sameAs || [], Object.values(a?.links || {}));
    }
  }
  // An artist page describes the artist and their shows.
  const [name, a] = withData.find(([, x]) => Object.keys(x.links || {}).length);
  const g2 = jsonLd(read(`artists/${a.slug}/index.html`)).flatMap((j) => j['@graph'] || [j]);
  const who = g2.find((n) => n['@type'] === 'MusicGroup');
  assert.equal(who.name, name);
  assert.deepEqual(who.sameAs, Object.values(a.links));
});

test('sitemap lists every page with the data date; headers point each page to its Markdown copy', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs.sort(), pages().map((p) => BASE + p).sort());
  assert.ok([...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].every((m) => m[1] === EV.dataDate));
  const headers = fs.readFileSync(path.join(out, '_headers'), 'utf8');
  for (const rule of [`/${SLUG}/`, `/${SLUG}/claude/`, `/${SLUG}/artists/*`]) {
    assert.match(headers, new RegExp(`^${rule.replace(/[*]/g, '\\*')}\\n  Link: <index\\.md>; rel="alternate"; type="text/markdown"$`, 'm'), rule);
  }
});

test('the Claude page: a prompt to copy, the single file and CLAUDE.md on GitHub, and the data as JSON', () => {
  const html = read('claude/index.html');
  assert.match(html, /<pre id="prompt"/, 'a prompt to copy, shown in full');
  assert.match(html, /<pre id="promptEn"[^>]*lang="en"/, 'and the same in English');
  assert.ok(html.includes(`https://raw.githubusercontent.com/luchichiTW/festival-planner/main/events/${SLUG}/artifact/index.html`));
  assert.ok(html.includes(`https://github.com/luchichiTW/festival-planner/blob/main/events/${SLUG}/CLAUDE.md`));
  assert.ok(html.includes(`${BASE}data/schedule.json`) && html.includes(`${BASE}data/artists.json`));
  const data = JSON.parse(read('data/schedule.json'));
  assert.equal(data.length, schedule.length);
  const pub = JSON.parse(read('data/artists.json'));
  assert.equal(Object.keys(pub).length, Object.keys(artists).length);
  assert.ok(Object.values(pub).every((x) => !('picks' in x)), 'pick notes stay in the repo');
  assert.match(html, /lang="en"/, 'an English summary for readers who do not read Chinese');
});

test('events without features.pages build no extra pages', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-nopages-'));
  process.env.FP_BUILD = 'nopages';
  try { build('megaport2026', { out: tmp, artifactOut: tmp + '-art' }); } finally { delete process.env.FP_BUILD; }
  for (const f of ['artists', 'claude', 'sitemap.xml', 'index.md']) assert.equal(fs.existsSync(path.join(tmp, 'megaport2026', f)), false, f);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tmp + '-art', { recursive: true, force: true });
});

test('the README carries the same prompt as the Claude page', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes(claudePrompt(EV)), 'README prompt matches the Claude page; update README.md when the prompt changes');
  assert.ok(read('claude/index.html').includes(claudePrompt(EV).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')));
});
