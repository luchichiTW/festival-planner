#!/usr/bin/env node
// Brings a "status": "lineup" event's data/lineup.json up to date with the festival's own lineup page.
//   node scripts/lineup.mjs <slug>           → prints what changed (nothing is written)
//   node scripts/lineup.mjs <slug> --write   → also writes data/lineup.json and moves event.json dataDate to today
// The lineup page is event.json urls.lineup (a WordPress page: one link per act). Each act's own page on that site
// gives its English name and the links the festival lists for it (Facebook, Instagram, YouTube, X, official site).
// Intros are not copied from anywhere: data/artists.json is written by hand from each act's own website (see the
// event's CLAUDE.md). The last line printed is a JSON summary, for scripts that run this every day.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadEvent, validate } from './validate.mjs';

const UA = 'chiparashi-festival-planner/1.0 (+https://chiparashi.tw/)';
const LABELS = { FACEBOOK: 'facebook', INSTAGRAM: 'instagram', YOUTUBE: 'youtube', X: 'x', TWITTER: 'x', OFFICIAL: 'official' };
const unesc = (s) => s.replace(/&#0*38;|&amp;/g, '&').replace(/&quot;|&#0*34;/g, '"').replace(/&#0*39;|&#8217;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The acts on the lineup page, in its order: the masonry grid's links (Enfold theme), each with the act's name.
export function parseLineup(html, base) {
  const host = new URL(base).hostname;
  const acts = [];
  for (const m of html.matchAll(/<a\s+href="([^"]+)"[^>]*class='[^']*av-masonry-entry[^']*'[^>]*title="([^"]*)"/g)) {
    const page = unesc(m[1]);
    if (new URL(page, base).hostname !== host) continue;
    acts.push({ name: unesc(m[2]).trim(), page: new URL(page, base).href });
  }
  return acts;
}

// One act's page: the page title (its name in that language) and the labelled link buttons in the page body.
export function parseAct(html) {
  const title = unesc(/<title>([^<]*)<\/title>/.exec(html)?.[1] || '').split(' - ')[0].trim();
  const start = html.indexOf("<div class='post-entry post-entry-type-page");
  const end = html.indexOf("id='footer'");
  const body = start >= 0 ? html.slice(start, end > start ? end : undefined) : '';
  const links = {};
  for (const m of body.matchAll(/<a href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g)) {
    const label = unesc(m[2].replace(/<[^>]+>/g, '')).trim().toUpperCase();
    const k = LABELS[label];
    if (k && !links[k]) links[k] = unesc(m[1]);
  }
  return { title, links };
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}
// A link the festival wrote as http://: use https when the site answers there, otherwise leave it out (and say so).
async function httpsOf(u, notes, who) {
  if (/^https:\/\//.test(u)) return u;
  const s = u.replace(/^http:\/\//, 'https://');
  try {
    const r = await fetch(s, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (r.ok) { notes.push(`${who}：${u} 改用 ${s}`); return s; }
  } catch { /* falls through */ }
  notes.push(`${who}：${u} 沒有 https，先不放`);
  return null;
}
// The English version of a WordPress (WPML) page lives under /en/.
const enPage = (page) => { const u = new URL(page); u.pathname = `/en${u.pathname}`; return u.href; };

export async function fetchLineup(ev, { delay = 300 } = {}) {
  const list = parseLineup(await get(ev.urls.lineup), ev.urls.lineup);
  if (!list.length) throw new Error(`${ev.urls.lineup} 找不到任何藝人（官網改版了？parseLineup 要跟著改）`);
  const notes = [];
  const acts = [];
  for (const a of list) {
    await sleep(delay);
    const zh = parseAct(await get(a.page));
    await sleep(delay);
    let en = '';
    try { en = parseAct(await get(enPage(a.page))).title; } catch (e) { notes.push(`${a.name}：英文頁讀不到（${e.message}）`); }
    const links = {};
    for (const [k, u] of Object.entries(zh.links)) { const s = await httpsOf(u, notes, a.name); if (s) links[k] = s; }
    acts.push({ name: a.name, ...(en && en !== a.name ? { en } : {}), page: a.page, links });
  }
  return { acts, notes };
}

// What changed between the lineup we have and the festival's: acts added, gone, or with a new English name or links.
export function diffLineup(before, after) {
  const was = new Map(before.map((a) => [a.name, a]));
  const now = new Map(after.map((a) => [a.name, a]));
  const added = after.filter((a) => !was.has(a.name)).map((a) => a.name);
  const removed = before.filter((a) => !now.has(a.name)).map((a) => a.name);
  const changed = after.filter((a) => was.has(a.name) && JSON.stringify(was.get(a.name)) !== JSON.stringify(a)).map((a) => a.name);
  const reordered = !added.length && !removed.length && before.map((a) => a.name).join('\n') !== after.map((a) => a.name).join('\n');
  return { added, removed, changed, reordered, same: !added.length && !removed.length && !changed.length && !reordered };
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) { console.error('用法：node scripts/lineup.mjs <活動代號> [--write]'); process.exit(2); }
  const loaded = loadEvent(slug);
  if (loaded.event.status !== 'lineup') { console.error(`${slug} 不是 "status": "lineup" 的活動`); process.exit(2); }
  const { acts, notes } = await fetchLineup(loaded.event);
  const d = diffLineup(loaded.lineup, acts);
  const needIntro = d.added.filter((n) => acts.find((a) => a.name === n)?.links.official);
  if (d.same) console.log('官網陣容沒有變動');
  else {
    if (d.added.length) console.log(`新增 ${d.added.length} 組：${d.added.join('、')}`);
    if (d.removed.length) console.log(`官網上不見了 ${d.removed.length} 組：${d.removed.join('、')}`);
    if (d.changed.length) console.log(`英文名或連結改了：${d.changed.join('、')}`);
    if (d.reordered) console.log('順序改了');
    if (needIntro.length) console.log(`要從官方網站寫簡介的新藝人：${needIntro.join('、')}`);
  }
  notes.forEach((m) => console.log(`  · ${m}`));
  if (!d.same && args.includes('--write')) {
    const dir = path.join(ROOT, 'events', slug);
    fs.writeFileSync(path.join(dir, 'data', 'lineup.json'), `[\n${acts.map((a) => `  ${JSON.stringify(a)}`).join(',\n')}\n]\n`);
    const evFile = path.join(dir, 'event.json');
    const ev = JSON.parse(fs.readFileSync(evFile, 'utf8'));
    ev.dataDate = today();
    fs.writeFileSync(evFile, `${JSON.stringify(ev, null, 2)}\n`);
    const report = validate(loadEvent(slug));
    report.errors.forEach((m) => console.log(`  ✗ ${m}`));
    report.warnings.forEach((m) => console.log(`  ! ${m}`));
    console.log(`已寫入 data/lineup.json（${acts.length} 組），dataDate ${ev.dataDate}`);
  }
  console.log(JSON.stringify({ slug, acts: acts.length, ...d, needIntro, written: !d.same && args.includes('--write') }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
