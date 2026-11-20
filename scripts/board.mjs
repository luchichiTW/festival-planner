#!/usr/bin/env node
// Pictures of an event's timetable as the planner shows it on a phone, light and dark, with a few sets picked. A
// "status": "lineup" event shows them in its card on top (event.json "demo": this event's slug), next to the link
// to try this event's planner.
//   node scripts/board.mjs <slug>   → events/<slug>/assets/board-light.webp and board-dark.webp
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadEvent } from './validate.mjs';
import { build } from './build.mjs';
import { serve } from './serve.mjs';
import { launch, sleep } from './lib/chrome.mjs';

const VIEW = { width: 390, height: 720 }; // a phone screen, a little shorter than a whole one
const OUT_WIDTH = 300; // about three pixels per point at the size the card shows it
const QUALITY = 0.8;

// Three sets on the first day that don't overlap, spread over the day: what a few picks look like.
function samplePicks(schedule) {
  const day = schedule.filter((s) => s.day === 1).sort((a, b) => a.start.localeCompare(b.start));
  const out = [];
  for (const s of day.filter((_, i) => i % 4 === 1)) {
    if (out.every((p) => s.start >= p.end || s.end <= p.start)) out.push(s);
    if (out.length === 3) break;
  }
  return out.map((s) => s.id);
}

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('用法：node scripts/board.mjs <活動代號>'); process.exit(2); }
  const { event: ev, schedule } = loadEvent(slug);
  if (ev.status) { console.error(`${slug} 還沒有時間表（status ${ev.status}）`); process.exit(2); }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-board-'));
  build(slug, { out, artifactOut: `${out}-art` });
  const server = await serve({ root: out, port: 0 });
  const chrome = await launch();
  try {
    const today = new Date();
    const seen = JSON.stringify({ d: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`, n: 3 });
    const picks = JSON.stringify({ v: 1, picks: samplePicks(schedule), prefs: [], t: 1 });
    for (const theme of ['light', 'dark']) {
      const page = await chrome.newPage({ ...VIEW, scale: 2 });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      const stored = { onboard: '1', 'hint-seen': '1', 'install-hint': seen, theme, picks };
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { for (const [k, v] of Object.entries(${JSON.stringify(stored)})) localStorage.setItem('fp:${slug}:' + k, v); } catch (e) {} })();` });
      await page.goto(`http://127.0.0.1:${server.port}/${slug}/`);
      await page.until(() => document.querySelectorAll('#grid .block').length > 0);
      await page.eval('document.fonts.ready');
      await sleep(600); // the board's own scroll to the first set
      const png = await page.screenshot();
      const webp = await page.eval(async (b64, w, q) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = Math.round((img.height * w) / img.width);
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', q).split(',')[1];
      }, png.toString('base64'), OUT_WIDTH, QUALITY);
      const file = path.join(ROOT, 'events', slug, 'assets', `board-${theme}.webp`);
      fs.writeFileSync(file, Buffer.from(webp, 'base64'));
      console.log(`✓ ${path.relative(process.cwd(), file)}（${Math.round(fs.statSync(file).size / 1024)} KB）`);
    }
  } finally {
    await chrome.close();
    await server.close();
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(`${out}-art`, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
