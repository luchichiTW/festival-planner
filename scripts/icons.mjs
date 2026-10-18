#!/usr/bin/env node
// Renders an event's home-screen icons from events/<slug>/assets/icon.html with headless Chrome.
//   node scripts/icons.mjs <slug>
// Writes the PNG paths listed in event.json "icons" (png sizes and the maskable one). The maskable icon is the
// same drawing; keep its content inside the centre circle of radius 40 % so Android's mask never cuts it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEvent } from './validate.mjs';
import { launch } from './lib/chrome.mjs';

const slug = process.argv[2];
if (!slug) { console.error('用法：node scripts/icons.mjs <活動代號>'); process.exit(2); }
const { event: ev, dir } = loadEvent(slug);
const src = pathToFileURL(path.join(dir, 'assets', 'icon.html')).href;
const jobs = Object.entries(ev.icons?.png || {}).map(([size, rel]) => [Number(size), rel]);
if (ev.icons?.maskable) jobs.push([512, ev.icons.maskable]);

const chrome = await launch({ args: ['--allow-file-access-from-files'] });
try {
  for (const [size, rel] of jobs) {
    const page = await chrome.newPage({ width: size, height: size, scale: 1, mobile: false, touch: false });
    await page.goto(src);
    await page.eval('document.fonts.ready.then(() => document.fonts.check("900 40px \\"Chiron GoRound TC\\""))');
    await page.screenshot(path.join(dir, rel), { x: 0, y: 0, width: size, height: size });
    console.log(`✓ ${rel}（${size}×${size}）`);
  }
} finally {
  await chrome.close();
}
