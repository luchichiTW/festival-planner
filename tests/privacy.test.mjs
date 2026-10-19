// Working offline and personal data: what the pages say (features, questions, privacy page, llms.txt) and the
// structured data that goes with it. The words come from scripts/lib/copy.mjs, which follows what the code does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, listEvents, loadEvent } from '../scripts/validate.mjs';
import { build, buildSite } from '../scripts/build.mjs';
import { FEATURES, FAQ, PRIVACY_UPDATED } from '../scripts/lib/copy.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const graphOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const j = JSON.parse(m[1]); return j['@graph'] || [j]; });
const meta = (html, attr, key) => new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html)?.[1] || '';
let out;
let site;
before(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-privacy-'));
  process.env.FP_BUILD = 'privacy-test';
  try { for (const s of ['vagabond2026', 'megaport2026', 'megaport2027']) build(s, { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  site = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-privacy-site-'));
  buildSite({ out: site });
});
after(() => { for (const d of [out, out + '-art', site]) fs.rmSync(d, { recursive: true, force: true }); });
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('nothing under the timetable; the app gets the features and questions for its 關於 sheet, website only', () => {
  for (const slug of ['vagabond2026', 'megaport2026']) {
    assert.equal(/class="board-about"/.test(read(out, slug, 'index.html')), false, `${slug}: nothing under the timetable`);
    const data = read(out, slug, 'data.js');
    const ev = JSON.parse(/window\.FP_EVENT = (\{[\s\S]*?\});\n/.exec(data)[1]);
    assert.deepEqual(ev.about.features.map((f) => f.title), FEATURES.map((f) => f.title), `${slug}: features`);
    assert.deepEqual(ev.about.faq.map((x) => [x.q, x.a]), FAQ.map((x) => [x.q, x.a]), `${slug}: questions`);
    assert.equal(ev.about.privacy, '/privacy/');
  }
  // The single-file artifact keeps picks in a Claude account, so none of this is said there.
  assert.match(read(out + '-art', 'megaport2026', 'index.html'), /"about":null/);
});

test('readers without JavaScript get the same features and questions in the text timetable', () => {
  const html = read(out, 'vagabond2026', 'index.html');
  const block = /<div class="static-about">[\s\S]*?<\/div>/.exec(html)?.[0] || '';
  for (const f of FEATURES) assert.ok(block.includes(esc(f.title)) && block.includes(esc(f.text)), f.title);
  for (const x of FAQ) assert.ok(block.includes(esc(x.q)) && block.includes(esc(x.a)), x.q);
  assert.ok(block.includes('href="/privacy/"'));
});

test('the event page carries FAQPage and WebApplication data, and its description says offline and no sign-up', () => {
  const html = read(out, 'vagabond2026', 'index.html');
  const graph = graphOf(html);
  const faq = graph.find((n) => n['@type'] === 'FAQPage');
  assert.deepEqual(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), FAQ.map((x) => [x.q, x.a]));
  const app = graph.find((n) => n['@type'] === 'WebApplication');
  assert.equal(app.isAccessibleForFree, true);
  assert.equal(app.offers.price, '0');
  assert.deepEqual(app.featureList, ['離線可用', '免註冊', '不蒐集個人資料']);
  assert.match(app.operatingSystem, /瀏覽器/);
  for (const d of [meta(html, 'name', 'description'), meta(html, 'property', 'og:description')]) {
    assert.match(d, /離線可用/);
    assert.match(d, /免註冊/);
  }
  assert.equal(graphOf(read(out, 'megaport2026', 'index.html')).length, 0, 'no structured data without features.pages');
});

test('every line has its English version in core/i18n.js', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'core', 'i18n.js'), 'utf8'), ctx);
  const en = ctx.window.FP_I18N.en;
  for (const f of FEATURES) { assert.equal(en[f.title], f.titleEn); assert.equal(en[f.text], f.textEn); }
  for (const x of FAQ) { assert.equal(en[x.q], x.qEn); assert.equal(en[x.a], x.aEn); }
  for (const k of ['特色', '常見問題', '隱私說明']) assert.ok(en[k], k);
});

test('the privacy page says what is not collected, what stays on the device, the statistics, Cloudflare and the players', () => {
  const html = read(site, 'privacy', 'index.html');
  assert.match(html, /<html lang="zh-Hant-TW"/);
  for (const s of ['帳號', '姓名', 'email', '位置', '團序不會上傳']) assert.ok(html.includes(s), s);
  for (const s of ['團序', '語言', '深淺色', '離線', '怎麼清除']) assert.ok(html.includes(s), s);
  assert.match(html, /Cloudflare Web Analytics[\s\S]*不用 cookie/);
  for (const s of ['哪一頁', '從哪個網站來', '國家', '裝置類型', '載入速度']) assert.ok(html.includes(s), s);
  assert.match(html, /Cloudflare[\s\S]*惡意流量/);
  for (const u of ['https://policies.google.com/privacy', 'https://www.spotify.com/tw/legal/privacy-policy/', 'https://www.apple.com/tw/legal/privacy/', 'https://streetvoice.com/legal/privacy/']) assert.ok(html.includes(`href="${u}"`), u);
  assert.ok(html.includes('https://www.instagram.com/luchichitw/') && html.includes('chi@chiparashi.tw'), 'contact');
  assert.ok(html.includes(PRIVACY_UPDATED.replace(/-/g, '/')), 'last updated');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="stylesheet"[^>]+href="(https?:)?\/\//, 'nothing loaded from other sites');
});

test('every page links to the privacy page, and the site sitemap lists it', () => {
  assert.ok(read(site, 'index.html').includes('href="/privacy/"'), 'homepage');
  const slug = 'vagabond2026';
  const { artists } = loadEvent(slug);
  const a = Object.values(artists).find((x) => x.slug && (x.bio || Object.keys(x.links || {}).length));
  for (const p of [`artists/${a.slug}/index.html`, 'claude/index.html']) assert.ok(read(out, slug, p).includes('href="/privacy/"'), p);
  assert.ok(read(out, 'megaport2027', 'index.html').includes('href="/privacy/"'), 'tba page');
  assert.ok(read(site, 'sitemap.xml').includes('<loc>https://chiparashi.tw/privacy/</loc>'));
});

test('the homepage says it too: features, WebApplication data, description', () => {
  const html = read(site, 'index.html');
  assert.ok(html.includes('離線可用') && html.includes('不用註冊、不蒐集個資'), 'visible features');
  const app = graphOf(html).find((n) => n['@type'] === 'WebApplication');
  assert.ok(app && app.isAccessibleForFree === true && app.offers.price === '0');
  assert.match(meta(html, 'name', 'description'), /離線可用.*免註冊|免註冊.*離線可用/);
});

test('llms.txt leads with offline use and no personal data, and points to the privacy page', () => {
  const txt = read(site, 'llms.txt');
  assert.match(txt, /^# chiparashi\n\n> chiparashi\.tw 上放的是非官方的音樂祭排團工具：看時間表、排出自己的團序、撞團時抽籤。離線可用、不用註冊、不蒐集個資。演出異動以主辦方現場公告為準。\n/);
  const feats = /## 特色\n\n([\s\S]*?)\n\n## /.exec(txt)?.[1] || '';
  assert.match(feats, /離線可用/);
  assert.match(feats, /不會上傳/);
  assert.match(feats, /Cloudflare Web Analytics/);
  assert.match(feats, /打開藝人卡片時才會載入/, 'players load when an artist card opens, as the code does');
  assert.ok(feats.includes('[隱私說明](https://chiparashi.tw/privacy/)'));
  assert.ok(listEvents().length > 0);
});
