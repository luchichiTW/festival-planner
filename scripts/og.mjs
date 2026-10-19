#!/usr/bin/env node
// Renders an event's link-preview image (1200×630, the picture chat apps and social sites show for a shared link)
// with headless Chrome, from event.json: the stage colours as a strip across the top, the wordmark, dates and
// place, and a tear-off stub saying it's an unofficial planner.
//   node scripts/og.mjs <slug>    → events/<slug>/assets/og.png (point event.json "ogImage" at it)
//   node scripts/og.mjs site      → site/og.png, the homepage's picture (also used by /privacy/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadEvent, listEvents } from './validate.mjs';
import { launch } from './lib/chrome.mjs';

const slug = process.argv[2];
if (!slug) { console.error('用法：node scripts/og.mjs <活動代號>，或 node scripts/og.mjs site（首頁）'); process.exit(2); }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Renders `html` (written next to `files`, a { name: source path } map) at 1200×630 into `target`.
async function render(html, target, files = {}) {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-og-'));
  for (const [name, src] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dirTmp, name)), { recursive: true }); fs.copyFileSync(src, path.join(dirTmp, name)); }
  const tmp = path.join(dirTmp, 'og.html');
  fs.writeFileSync(tmp, html);
  const chrome = await launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await chrome.newPage({ width: 1200, height: 630, scale: 1, mobile: false, touch: false });
    await page.goto(pathToFileURL(tmp).href);
    await page.eval('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))');
    await page.screenshot(target, { x: 0, y: 0, width: 1200, height: 630 });
    console.log(`✓ ${path.relative(process.cwd(), target)}（1200×630）`);
  } finally {
    await chrome.close();
    fs.rmSync(dirTmp, { recursive: true, force: true });
  }
}

if (slug === 'site') {
  // The homepage's picture: the brand, what the planner does, and one slim ticket per event in the homepage's own
  // ticket style (no dates or countdown, so it doesn't go stale). Re-run when an event is added or its icon changes.
  //   node scripts/og.mjs site    → site/og.png
  const { ticket } = await import('./build.mjs');
  const home = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
  const css = /<style>([\s\S]*?)<\/style>/.exec(home)[1];
  const evs = listEvents().map((s) => loadEvent(s).event).sort((a, b) => !!a.urls?.archive - !!b.urls?.archive || (a.days?.[0]?.date || '9').localeCompare(b.days?.[0]?.date || '9')).slice(0, 3);
  const files = Object.fromEntries(evs.filter((e) => e.icons?.png?.['192']).map((e) => [`icons/${e.slug}.png`, path.join(ROOT, 'events', e.slug, e.icons.png['192'])]));
  const brand = /<span class="brand">([\s\S]*?)<\/span>/.exec(home)[1];
  const html = `<!doctype html><html lang="zh-Hant-TW" data-theme="light"><head><meta charset="utf-8"><style>${css}
*, *::before, *::after { animation: none !important; transition: none !important; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
.og { width: 1200px; height: 630px; padding: 0 64px 0 72px; display: grid; grid-template-columns: minmax(0, 1fr) 450px; gap: 52px; align-items: center; }
.og-l { display: grid; gap: 24px; align-content: center; }
.og .brand { gap: 12px; font-size: 34px; }
.og .mark { width: 52px; height: 52px; }
.og h1 { font-size: 72px; line-height: 1.1; white-space: nowrap; }
.og .lede { font-size: 27px; line-height: 1.6; max-width: none; white-space: nowrap; }
.og .feats { margin: 0; font: 700 24px/1.4 var(--sans); color: var(--accent); letter-spacing: .04em; white-space: nowrap; }
.og-r { display: grid; gap: 20px; }
.og .ticket { grid-template-columns: minmax(0, 1fr); border-radius: 22px; }
.og .t-main { gap: 0; padding: 0 22px 20px; }
.og .t-stripe { height: 10px; margin-bottom: 18px; }
.og .t-days, .og .t-stages, .og .t-stub { display: none; }
.og .t-icon { width: 64px; height: 64px; border-radius: 15px; }
.og .t-mark { font-size: 34px; }
.og .t-mark small { font-size: 20px; }
.og .t-where { font-size: 18px; }
</style></head><body><div class="og">
  <div class="og-l">
    <span class="brand">${brand}</span>
    <h1>音樂祭排團工具</h1>
    <p class="lede">看時間表、排出自己的團序、撞團時抽籤。<br>加到手機主畫面，現場沒訊號也打得開。</p>
    <p class="feats">非官方・免費・離線可用・不蒐集個資</p>
  </div>
  <div class="og-r">
${evs.map(ticket).join('\n')}
  </div>
</div></body></html>`;
  await render(html, path.join(ROOT, 'site', 'og.png'), files);
  process.exit(0);
}

const { event: ev, schedule, dir } = loadEvent(slug);
const t = ev.theme.dark;
const font = ev.fonts?.display?.file ? pathToFileURL(path.join(dir, ev.fonts.display.file)).href : '';
const mono = ev.fonts?.mono?.file ? pathToFileURL(path.join(dir, ev.fonts.mono.file)).href : '';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font ? `@font-face { font-family: "D"; src: url(${font}) format("woff2"); font-weight: 900; }` : ''}
${mono ? `@font-face { font-family: "M"; src: url(${mono}) format("woff2"); font-weight: 400 700; }` : ''}
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: ${t.bg}; color: ${t.fg}; font-family: "PingFang TC", "Noto Sans TC", sans-serif; }
.card { position: absolute; inset: 0; display: grid; grid-template-rows: 64px 1fr 120px; }
.strip { display: grid; grid-template-columns: repeat(${ev.stages.length}, 1fr); }
.body { padding: 54px 84px 0; display: grid; align-content: center; gap: 22px; }
.wm { font: 900 132px/1 "D", "PingFang TC", sans-serif; color: ${t.brand || t.gold}; text-shadow: 5px 5px 0 ${t['brand-shadow'] || 'transparent'}, 10px 10px 0 ${t['brand-shadow-2'] || 'transparent'}; letter-spacing: .02em; }
.wm small { margin-left: 22px; font: 500 46px "M", ui-monospace, monospace; color: ${t.muted}; text-shadow: none; letter-spacing: 0; }
.meta { font-size: 38px; font-weight: 600; color: ${t.fg}; }
.count { font-size: 28px; font-weight: 500; font-variant-numeric: tabular-nums; color: ${t.muted}; }
.stub { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 0 84px; border-top: 4px dashed ${t['line-2'] || t.muted}; font-size: 32px; color: ${t.muted}; }
.stub b { color: ${t.gold}; font-weight: 700; }
.stub::before, .stub::after { content: ""; position: absolute; top: -26px; width: 48px; height: 48px; border-radius: 50%; background: ${t['bg-2'] || '#000'}; }
.stub::before { left: -24px; } .stub::after { right: -24px; }
</style></head><body><div class="card">
<div class="strip">${ev.stages.map((s) => `<span style="background:${s.color.dark}"></span>`).join('')}</div>
<div class="body">
  <div class="wm">${esc(ev.wordmark?.text || ev.shortName)}<small>${esc(ev.wordmark?.sub || '')}</small></div>
  <div class="meta">${esc(ev.subtitle || '')}</div>
  <div class="count">${ev.stages.length} 個舞台・${schedule.length} 場演出</div>
</div>
<div class="stub"><span>排團・撞團抽籤・沒訊號也能開</span><b>非官方排團工具</b></div>
</div></body></html>`;

await render(html, path.join(dir, 'assets', 'og.png'));
