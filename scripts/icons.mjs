#!/usr/bin/env node
// Renders home-screen icons with headless Chrome.
//   node scripts/icons.mjs <slug>   → an event's icons from events/<slug>/assets/icon.html
//   node scripts/icons.mjs site     → the homepage's icon files from site/favicon.svg: site/favicon.ico (16, 32, 48,
//                                     96 and 144 px) and site/apple-touch-icon.png (180 px, square: iOS rounds it)
// For an event: writes the PNG paths listed in event.json "icons" (png sizes and the maskable one). The maskable icon
// is the same drawing; keep its content inside the centre circle of radius 40 % so Android's mask never cuts it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadEvent } from './validate.mjs';
import { launch } from './lib/chrome.mjs';

const ICO_SIZES = [16, 32, 48, 96, 144];

// An .ico holding PNG pictures (every browser since 2007 reads them): a header, one entry per picture, the pictures.
export function packIco(pngs) {
  const head = Buffer.alloc(6 + pngs.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let at = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

// The homepage's icon, drawn from site/favicon.svg at each size on a see-through background.
async function siteIcons() {
  const svg = fs.readFileSync(path.join(ROOT, 'site', 'favicon.svg'), 'utf8');
  // iOS rounds the home-screen icon itself and fills see-through corners black: draw this one to the edges.
  const square = svg.replace(/(<rect width="32" height="32") rx="8"/, '$1');
  const chrome = await launch();
  const render = async (drawing, size) => {
    const page = await chrome.newPage({ width: size, height: size, scale: 1, mobile: false, touch: false });
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${drawing}`)}`);
    return page.screenshot(null, { x: 0, y: 0, width: size, height: size });
  };
  try {
    const pngs = [];
    for (const size of ICO_SIZES) pngs.push({ size, png: await render(svg, size) });
    fs.writeFileSync(path.join(ROOT, 'site', 'favicon.ico'), packIco(pngs));
    console.log(`✓ site/favicon.ico（${ICO_SIZES.join('、')}）`);
    fs.writeFileSync(path.join(ROOT, 'site', 'apple-touch-icon.png'), await render(square, 180));
    console.log('✓ site/apple-touch-icon.png（180×180）');
  } finally {
    await chrome.close();
  }
}

const slug = process.argv[2];
if (!slug) { console.error('用法：node scripts/icons.mjs <活動代號>，或 node scripts/icons.mjs site（首頁）'); process.exit(2); }
if (slug === 'site') { await siteIcons(); process.exit(0); }
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
