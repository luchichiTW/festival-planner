// The chiparashi.tw homepage (scripts/build.mjs site): one ticket per event painted from its event.json, plus the
// site-wide robots.txt, llms.txt and sitemap.xml, and the workflow that deploys it on every push that changes it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadEvent, listEvents } from '../scripts/validate.mjs';
import { build, buildSite } from '../scripts/build.mjs';

const HOST = 'https://chiparashi.tw';
const events = listEvents().map((s) => loadEvent(s).event);
const archived = (ev) => !!ev.urls?.archive;
const DOW = '日一二三四五六';
let out;
before(() => { out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-site-')); buildSite({ out }); });
after(() => fs.rmSync(out, { recursive: true, force: true }));
const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
const ticketOf = (html, slug) => new RegExp(`<a class="ticket"[^>]* href="${slug}/"[\\s\\S]*?</a>`).exec(html)?.[0] || '';

test('the homepage ships its own files, icons included, and loads nothing from other sites', () => {
  assert.deepEqual(fs.readdirSync(out).sort(), ['icons', 'index.html', 'llms.txt', 'og.png', 'privacy', 'robots.txt', 'sitemap.xml']);
  // Icons are the homepage's own copies: an event's path may redirect elsewhere once the event moves (urls.archive).
  for (const ev of events) {
    assert.ok(fs.existsSync(path.join(out, 'icons', `${ev.slug}.png`)), `${ev.slug} icon copied`);
    assert.ok(read('index.html').includes(`<img class="t-icon" src="icons/${ev.slug}.png"`), `${ev.slug} ticket uses the copy`);
  }
  const html = read('index.html');
  // Loaded resources only: a canonical link or an <a href> to another site loads nothing.
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="(stylesheet|preload|modulepreload|icon|apple-touch-icon|manifest)"[^>]+href="(https?:)?\/\/|<img[^>]+src="(https?:)?\/\/|fonts\.googleapis/, 'no scripts, styles, fonts or images from other sites');
  assert.doesNotMatch(html, /claude:viewport-fit-sides/);
  assert.match(html, /<title>chiparashi — 音樂祭排團工具<\/title>/);
});

test('one ticket per event, painted from its event.json: wordmark, place, days, stage strip and chips', () => {
  const html = read('index.html');
  for (const ev of events) {
    const t = ticketOf(html, ev.slug);
    assert.ok(t, `${ev.slug} has a ticket linking to its page`);
    const d = ev.theme.dark;
    assert.ok(t.includes(`--tl:${d.bg}`), `${ev.slug}: ticket on the light page uses the event's dark background`);
    assert.ok(t.includes(`--t-accent:${d['accent-text'] || d.gold}`) && t.includes(`--t-fg:${d.fg}`), `${ev.slug}: text and accent colours`);
    assert.ok(t.includes(`${ev.wordmark?.text || ev.shortName}<small>${ev.wordmark?.sub || ''}</small>`), `${ev.slug}: wordmark`);
    if (ev.status === 'tba') {
      assert.ok(t.includes("data-days='[]'"), `${ev.slug}: no dates yet`);
      assert.doesNotMatch(t, /class="t-days"|class="t-stages"/, `${ev.slug}: no days or stages`);
      continue;
    }
    assert.equal((t.match(/<i style="--s:/g) || []).length, ev.stages.length, `${ev.slug}: one stripe per stage`);
    for (const st of ev.stages) assert.ok(t.includes(`<li style="--s:${st.color.dark}">`), `${ev.slug}: chip for ${st.id}`);
    for (const day of ev.days) {
      const [y, m, dd] = day.date.split('-').map(Number);
      const label = `${String(m).padStart(2, '0')}/${String(dd).padStart(2, '0')}（${DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}）`;
      assert.ok(t.includes(`<dt>${day.label}</dt><dd>${label}</dd><dd class="t-time">${day.start}–${day.end}</dd>`), `${ev.slug}: ${day.label}`);
    }
    assert.ok(t.includes(ev.venue?.name || ''), `${ev.slug}: place`);
  }
});

test('the homepage says what the site is and who runs it: WebSite, Person with Instagram only, WebApplication part of the site', () => {
  const html = read('index.html');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1);
  const graph = blocks[0]['@graph'];
  const site = graph.find((n) => n['@type'] === 'WebSite');
  assert.equal(site['@id'], `${HOST}/#website`);
  assert.equal(site.name, 'chiparashi');
  assert.equal(site.url, `${HOST}/`);
  assert.equal(site.inLanguage, 'zh-Hant-TW');
  assert.equal(site.description, /<meta name="description" content="([^"]*)"/.exec(html)[1].replace(/&amp;/g, '&'), 'same words as the meta description');
  const person = graph.find((n) => n['@type'] === 'Person');
  assert.deepEqual(site.publisher, { '@id': person['@id'] });
  assert.equal(person.name, 'Chi');
  assert.deepEqual(person.sameAs, ['https://www.instagram.com/luchichitw/'], 'Instagram is the only account named');
  const app = graph.find((n) => n['@type'] === 'WebApplication');
  assert.deepEqual(app.isPartOf, { '@id': site['@id'] });
  // No other site is named anywhere in the structured data.
  const urls = [...JSON.stringify(blocks[0]).matchAll(/https?:\/\/[^"]+/g)].map((m) => m[0]);
  for (const u of urls) assert.ok(u === 'https://schema.org' || u.startsWith(`${HOST}/`) || u === 'https://www.instagram.com/luchichitw/', u);
});

// A shared link (Facebook, Threads, Instagram messages, LINE) shows this card: title, description and a 1200×630 picture.
const og = (html) => Object.fromEntries([...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const pngSize = (file) => { const b = fs.readFileSync(file); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
test('link preview: the homepage and the privacy page share the homepage picture, 1200×630, made by scripts/og.mjs site', () => {
  assert.deepEqual(pngSize(path.join(ROOT, 'site', 'og.png')), [1200, 630], 'site/og.png (node scripts/og.mjs site)');
  assert.ok(fs.readFileSync(path.join(out, 'og.png')).equals(fs.readFileSync(path.join(ROOT, 'site', 'og.png'))), 'copied as it is');
  for (const [file, url] of [['index.html', `${HOST}/`], ['privacy/index.html', `${HOST}/privacy/`]]) {
    const tags = og(read(file));
    assert.equal(tags['og:url'], url, file);
    assert.ok(tags['og:title'] && tags['og:description'], `${file}: title and description`);
    assert.equal(tags['og:type'], 'website', file);
    assert.equal(tags['og:site_name'], 'chiparashi', file);
    assert.equal(tags['og:image'], `${HOST}/og.png`, file);
    assert.equal(tags['og:image:width'], '1200', file);
    assert.equal(tags['og:image:height'], '630', file);
    assert.ok(tags['og:image:alt'], `${file}: the picture described`);
    assert.equal(tags['og:locale'], 'zh_TW', file);
    assert.equal(tags['twitter:card'], 'summary_large_image', file);
  }
});

// The pages describe a tool and cite their sources; whose tool it is, is in the repo's README.
test('no page calls itself unofficial: not the homepage, privacy page, llms.txt, nor any event page', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-noun-'));
  process.env.FP_BUILD = 'copy-check';
  try { for (const s of listEvents()) build(s, { out: tmp, artifactOut: tmp + '-art' }); } finally { delete process.env.FP_BUILD; }
  const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : /\.(html|md|js|txt|xml|json|webmanifest)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const hits = [...files(out), ...files(tmp)].filter((f) => /非官方|unofficial/i.test(fs.readFileSync(f, 'utf8')));
  fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmp + '-art', { recursive: true, force: true });
  assert.deepEqual(hits.map((f) => path.relative(f.startsWith(out) ? out : tmp, f)), []);
});

test('contact and footer', () => {
  const html = read('index.html');
  assert.ok(html.includes('href="https://www.instagram.com/luchichitw/"'));
  assert.ok(html.includes('chi@chiparashi.tw') && /id="copyMail"/.test(html), 'email with a copy button');
  assert.match(html, /<footer class="foot">\s*<p>演出異動以主辦方現場公告為準。<\/p>\s*<p><a href="\/privacy\/">隱私說明<\/a><\/p>\s*<\/footer>/);
});

test('robots.txt: content signals for everyone, a block list, the site sitemap and each event sitemap', () => {
  const txt = read('robots.txt');
  assert.match(txt, /^# chiparashi\.tw\n/);
  const groups = txt.split(/\n\s*\n/).filter((g) => /^User-agent:/m.test(g));
  assert.equal(groups.length, 2, 'everyone, and the blocked crawlers');
  assert.match(groups[0], /^User-agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: \/$/);
  const blocked = [...groups[1].matchAll(/^User-agent: (\S+)$/gm)].map((m) => m[1]);
  assert.match(groups[1], /\nDisallow: \/$/);
  assert.ok(blocked.includes('Bingbot') && blocked.includes('Baiduspider') && blocked.includes('GPTBot'));
  // Search and answer crawlers that should still read the site stay in the * group, so the content signals reach them.
  for (const ua of ['Googlebot', 'Google-Extended', 'Claude-SearchBot', 'Claude-User', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'DuckDuckBot', 'DuckAssistBot', 'Applebot', 'Amazonbot', 'YandexBot', 'facebookexternalhit']) {
    assert.ok(!blocked.includes(ua), `${ua} is not blocked`);
    assert.doesNotMatch(txt, new RegExp(`^User-agent: ${ua}$`, 'm'), `${ua} has no group of its own`);
  }
  const maps = [...txt.matchAll(/^Sitemap: (\S+)$/gm)].map((m) => m[1]);
  const withPages = events.filter((ev) => ev.features?.pages && !archived(ev)).map((ev) => `${HOST}/${ev.slug}/sitemap.xml`);
  assert.deepEqual(maps, [`${HOST}/sitemap.xml`, ...withPages]);
});

test('llms.txt: the festivals from event.json, moved ones linking to where they went, and the pages for assistants', () => {
  const txt = read('llms.txt');
  assert.match(txt, /^# chiparashi\n\n> .*音樂祭排團工具/);
  const list = /## 音樂祭排團工具\n\n([\s\S]*?)\n\n## /.exec(txt)?.[1] || '';
  for (const ev of events) {
    const url = archived(ev) ? ev.urls.archive : `${HOST}/${ev.slug}/`;
    assert.ok(list.includes(`](${url})`), `${ev.slug} → ${url}`);
    if (archived(ev)) assert.ok(list.includes(`[${ev.name}（舊版）]`) && /已結束/.test(list.split('\n').find((l) => l.includes(url))), `${ev.slug}: old version, over`);
    if (ev.status === 'tba') assert.match(list.split('\n').find((l) => l.includes(url)), /日期和陣容待官方公布/);
  }
  const vb = list.split('\n').find((l) => l.includes(`${HOST}/vagabond2026/`));
  assert.match(vb, /2026 年 11 月 7–8 日/);
  assert.match(vb, /7 個舞台/);
  const ai = /## 給 AI 助理\n\n([\s\S]*?)\n\n## /.exec(txt)?.[1] || '';
  for (const ev of events.filter((e) => e.features?.pages && !archived(e))) {
    for (const p of ['claude/', 'data/schedule.json', 'data/artists.json']) assert.ok(ai.includes(`${HOST}/${ev.slug}/${p}`), `${ev.slug} ${p}`);
  }
  assert.match(txt, /## Optional\n\n- \[festival-planner 原始碼\]\(https:\/\/github\.com\/luchichiTW\/festival-planner\)/);
});

test('sitemap.xml: the homepage and every event still served here, not the ones that moved', () => {
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs.sort(), [`${HOST}/`, `${HOST}/privacy/`, ...events.filter((ev) => !archived(ev)).map((ev) => `${HOST}/${ev.slug}/`)].sort());
});

test('the homepage deploys itself on pushes to main that change it; events stay manual; nothing with the token runs on pull requests', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  const site = fs.readFileSync(path.join(dir, 'site.yml'), 'utf8');
  assert.match(site, /^on:\n  push:\n    branches: \[main\]\n    paths:\n/m);
  for (const p of ["'site/**'", "'events/*/event.json'", "'events/*/assets/icon-192.png'", "'scripts/build.mjs'"]) assert.ok(site.includes(`- ${p}`), p);
  assert.match(site, /^  workflow_dispatch:/m);
  assert.match(site, /command: deploy --config site\/wrangler\.jsonc/);
  const events = fs.readFileSync(path.join(dir, 'deploy.yml'), 'utf8');
  assert.match(events, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(events, /^\s+push:/m, 'events deploy only by hand');
  for (const f of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /pull_request/, `${f}: no pull request triggers`);
});
