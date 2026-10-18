#!/usr/bin/env node
// Renders an event's link-preview image (1200×630, the picture chat apps and social sites show for a shared link)
// with headless Chrome, from event.json: the stage colours as a strip across the top, the wordmark, dates and
// place, and a tear-off stub saying it's an unofficial planner.
//   node scripts/og.mjs <slug>    → events/<slug>/assets/og.png (point event.json "ogImage" at it)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEvent } from './validate.mjs';
import { launch } from './lib/chrome.mjs';

const slug = process.argv[2];
if (!slug) { console.error('用法：node scripts/og.mjs <活動代號>'); process.exit(2); }
const { event: ev, schedule, dir } = loadEvent(slug);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-og-')), 'og.html');
fs.writeFileSync(tmp, html);
const target = path.join(dir, 'assets', 'og.png');
const chrome = await launch({ args: ['--allow-file-access-from-files'] });
try {
  const page = await chrome.newPage({ width: 1200, height: 630, scale: 1, mobile: false, touch: false });
  await page.goto(pathToFileURL(tmp).href);
  await page.eval('document.fonts.ready');
  await page.screenshot(target, { x: 0, y: 0, width: 1200, height: 630 });
  console.log(`✓ ${path.relative(process.cwd(), target)}（1200×630）`);
} finally {
  await chrome.close();
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
}
