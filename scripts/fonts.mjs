#!/usr/bin/env node
// Downloads small font files holding only the characters an event uses, so the page needs no font CDN at run time.
//   node scripts/fonts.mjs <slug>
// Reads event.json "fonts": { "display": { "family", "file", "weight" }, "mono": { ... } } and asks the
// Google Fonts API for a subset (its text= parameter). Run it again when names in schedule.json change:
// a character missing from the subset still shows, just in the fallback font.
// All fonts used here are under the SIL Open Font License; see the event's assets/fonts/LICENSE.md.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadEvent } from './validate.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

// display: every name, label and UI string the display face can render (lottery results show any show name).
function displayText(ev, schedule) {
  const ui = ['core/app.js', 'core/index.html'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('');
  const t = [ev.wordmark?.text, ev.wordmark?.sub, ev.shortName, ...ev.stages.flatMap((s) => [s.name, s.short]),
    ...ev.days.map((d) => d.label), ...schedule.map((s) => s.name), ui].join('');
  return [...new Set([...ASCII, ...[...t].filter((c) => c.codePointAt(0) > 0x7e)])].join('');
}
// mono: times, counts and dates only.
const monoText = () => ASCII + '–·×→↗';

async function subset(family, weight, text, dest) {
  const axis = /\s/.test(weight) ? weight.replace(/\s+/, '..') : weight;
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${axis}&text=${encodeURIComponent(text)}&display=swap`;
  const css = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
  const src = /src:\s*url\((https:[^)]+)\)\s*format\('woff2'\)/.exec(css);
  if (!src) throw new Error(`${family}: Google Fonts did not return a woff2 file\n${css.slice(0, 300)}`);
  const buf = Buffer.from(await (await fetch(src[1], { headers: { 'user-agent': UA } })).arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const slug = process.argv[2];
if (!slug) { console.error('用法：node scripts/fonts.mjs <活動代號>'); process.exit(2); }
const { event: ev, schedule, dir } = loadEvent(slug);
const jobs = { display: () => displayText(ev, schedule), mono: monoText };
for (const [role, textOf] of Object.entries(jobs)) {
  const f = ev.fonts?.[role];
  if (!f?.family || !f.file) continue;
  const text = textOf();
  try {
    const n = await subset(f.family, f.weight || '400', text, path.join(dir, f.file));
    console.log(`✓ ${role}: ${f.family} ${f.weight || '400'}，${[...text].length} 個字 → ${f.file}（${(n / 1024).toFixed(1)} KB）`);
  } catch (e) {
    console.error(`✗ ${role}: ${e.message}`);
    process.exitCode = 1;
  }
}
