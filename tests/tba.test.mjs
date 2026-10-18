// An event announced by name only (event.json "status": "tba"): no dates, stages or timetable yet. It gets one page
// that says so, in the event's colours, and becomes the full planner once the official timetable is out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEvent, listEvents, validate } from '../scripts/validate.mjs';
import { build, buildSite } from '../scripts/build.mjs';

const SLUG = 'megaport2027';
const clone = (o) => JSON.parse(JSON.stringify(o));

test('a tba event validates without dates, stages or a timetable, but needs its notice', () => {
  assert.ok(listEvents().includes(SLUG));
  const ev = loadEvent(SLUG);
  assert.equal(ev.event.status, 'tba');
  assert.deepEqual(ev.schedule, []);
  assert.deepEqual(validate(ev).errors, []);
  const noNotice = clone(ev);
  delete noNotice.event.notice;
  assert.ok(validate(noNotice).errors.some((e) => /notice/.test(e)));
  const withShows = clone(ev);
  withShows.schedule = loadEvent('megaport2026').schedule.slice(0, 1);
  assert.ok(validate(withShows).errors.some((e) => /tba/.test(e)), 'a timetable means it is not tba any more');
});

test('a tba event builds one page with the notice, no planner, no service worker, and still redirects /<slug>', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-tba-'));
  process.env.FP_BUILD = 'tba-test';
  try { build(SLUG, { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  const site = path.join(out, SLUG);
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const { event: ev } = loadEvent(SLUG);
  assert.ok(html.includes(ev.notice), 'shows the notice');
  assert.ok(html.includes(ev.name), 'names the event');
  assert.match(html, /<html lang="zh-Hant-TW"/);
  assert.doesNotMatch(html, /id="grid"|sw\.js|serviceWorker/, 'no planner and no offline install yet');
  assert.equal(fs.existsSync(path.join(site, 'sw.js')), false);
  assert.ok(fs.existsSync(path.join(site, 'icon-192.png')), 'icons for the homepage card');
  assert.doesNotMatch(html, /<script[^>]+src="https?:|<link[^>]+href="https?:\/\/(?!chiparashi)/, 'nothing from other sites');
  assert.match(fs.readFileSync(path.join(out, '_redirects'), 'utf8'), new RegExp(`^/${SLUG} /${SLUG}/ 301$`, 'm'));
  assert.equal(fs.existsSync(path.join(out + '-art', SLUG)), false, 'no single-file artifact for a page without a timetable');
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(out + '-art', { recursive: true, force: true });
});

test('the homepage lists a tba event without dates', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-tba-site-'));
  buildSite({ out });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const t = new RegExp(`<a class="ticket"[^>]* href="${SLUG}/"[\\s\\S]*?</a>`).exec(html)?.[0] || '';
  assert.ok(t.includes("data-days='[]'"), 'a ticket without dates');
  assert.ok(t.includes(loadEvent(SLUG).event.notice), 'saying the details are on the way');
  fs.rmSync(out, { recursive: true, force: true });
});
