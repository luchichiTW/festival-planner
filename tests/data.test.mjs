// Data and build checks that need no browser.  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, loadEvent, listEvents, validate } from '../scripts/validate.mjs';
import { build, buildSite } from '../scripts/build.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const fresh = () => clone(loadEvent('vagabond2026'));

test('every event under events/ passes validation', () => {
  for (const slug of listEvents()) {
    const { errors } = validate(loadEvent(slug));
    assert.deepEqual(errors, [], `${slug} has errors`);
  }
});

test('vagabond2026 keeps all 74 shows and the artifact order in seq', () => {
  const { schedule } = loadEvent('vagabond2026');
  assert.equal(schedule.length, 74);
  assert.deepEqual(schedule.map((s) => s.seq), schedule.map((_, i) => i));
});

test('validate catches broken schedules', () => {
  const cases = [
    ['duplicate id', (ev) => { ev.schedule[1].id = ev.schedule[0].id; }, /id 重複/],
    ['duplicate seq', (ev) => { ev.schedule[1].seq = 0; }, /seq 0 重複/],
    ['id day mismatch', (ev) => { ev.schedule[0].id = 'd2-bzai'; }, /跟 day 1 不一致/],
    ['bad time', (ev) => { ev.schedule[0].start = '25:00'; }, /HH:MM/],
    ['end before start', (ev) => { ev.schedule[0].end = '12:00'; }, /要早於結束/],
    ['outside the day', (ev) => { ev.schedule[0].start = '10:00'; }, /超出當天/],
    ['same-stage overlap', (ev) => { ev.schedule[1].start = '13:00'; }, /時間重疊/],
    ['unknown stage', (ev) => { ev.schedule[0].stage = 'Z'; }, /舞台 "Z"/],
    ['unknown day', (ev) => { ev.schedule[0].day = 3; ev.schedule[0].id = 'd3-bzai'; }, /day 3 不在/],
  ];
  for (const [name, breakIt, expected] of cases) {
    const ev = fresh();
    breakIt(ev);
    const { errors } = validate(ev);
    assert.ok(errors.some((e) => expected.test(e)), `${name}: expected ${expected}, got ${JSON.stringify(errors)}`);
  }
});

test('validate catches bad artist data', () => {
  const cases = [
    ['one source', (a) => { a['ano'].sources = a['ano'].sources.slice(0, 1); }, /至少要 2 個不同網站/],
    ['search page link', (a) => { a['ano'].links.spotify = 'https://open.spotify.com/search/ano'; }, /不是藝人頁格式/],
    ['unknown platform', (a) => { a['ano'].links.tiktok = 'https://www.tiktok.com/@ano'; }, /不支援的平台/],
    ['http source', (a) => { a['ano'].sources[0] = 'http://example.com/ano'; }, /https/],
  ];
  for (const [name, breakIt, expected] of cases) {
    const ev = fresh();
    breakIt(ev.artists);
    const { errors } = validate(ev);
    assert.ok(errors.some((e) => expected.test(e)), `${name}: expected ${expected}, got ${JSON.stringify(errors)}`);
  }
  const ev = fresh();
  ev.artists['ano'].sources = ['https://www.last.fm/music/ano', 'https://en.wikipedia.org/wiki/Ano_(singer)'];
  assert.ok(validate(ev).errors.some((e) => /至少要 2 個不同網站的來源（現在 1 個）/.test(e)), 'Last.fm does not count as a source');
});

test('build writes the website, the service worker file list and the single-file artifact', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-build-'));
  process.env.FP_BUILD = 'test-build';
  try {
    const r = build('vagabond2026', { out: path.join(out, 'dist'), artifactOut: path.join(out, 'art') });
    const site = path.join(out, 'dist', 'vagabond2026');
    for (const f of r.files.filter((f) => f !== './')) assert.ok(fs.existsSync(path.join(site, f)), `missing ${f}`);
    const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.match(html, /<meta name="fp-build" content="test-build">/);
    assert.doesNotMatch(html, /\{\{|fp:web|fp:body|googleapis|gstatic/);
    const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
    assert.match(sw, /const VERSION = "test-build";/);
    assert.match(sw, /const CACHE = "fp-vagabond2026-test-build";/);
    assert.doesNotMatch(sw, /'__(VERSION|CACHE|PREFIX)__'|= __FILES__/);
    const data = fs.readFileSync(path.join(site, 'data.js'), 'utf8');
    assert.match(data, /"mode":"web"/);
    const single = fs.readFileSync(r.artifact, 'utf8');
    assert.ok(single.startsWith('<title>浪人祭 2026</title>'), 'artifact starts with its title');
    assert.match(single, /"mode":"artifact"/);
    assert.match(single, /window\.claude/);
    assert.doesNotMatch(single, /installHint|<script src=|googleapis/);
    assert.ok(Buffer.byteLength(single) < 2 * 1024 * 1024, 'artifact stays small');
  } finally {
    delete process.env.FP_BUILD;
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a slug may not start another event\'s slug (routes are <slug>*)', () => {
  const ev = fresh();
  ev.slug = 'vaga';
  ev.event.slug = 'vaga';
  assert.ok(validate(ev).errors.some((e) => /開頭相同/.test(e)));
});

test('megaport2026 keeps all 121 shows, the original ids, and every stage but KIDS on the map', () => {
  const mp = loadEvent('megaport2026');
  assert.equal(mp.schedule.length, 121);
  assert.ok(mp.schedule.every((s) => /^d[12]-[a-z]{2}-\d+$/.test(s.id)));
  assert.deepEqual(Object.keys(mp.venue.map.regions).sort(), mp.event.stages.map((s) => s.id).filter((id) => id !== 'KD').sort());
});

test('validate catches bad streaming IDs, unknown members and broken venue data', () => {
  const freshMp = () => clone(loadEvent('megaport2026'));
  const cases = [
    ['bad spotify id', (ev) => { ev.artists['椅子樂團'].embeds.spotify = 'nope'; }, /spotify 的 ID "nope" 格式不對/],
    ['unknown platform', (ev) => { ev.artists['椅子樂團'].embeds.soundcloud = '123'; }, /不支援的內嵌平台/],
    ['unknown member', (ev) => { ev.artists['LAWA ft. Angie安吉'].members.push('Nobody'); }, /members 裡的 "Nobody"/],
    ['hotspot on a missing stage', (ev) => { ev.venue.map.regions.ZZ = { x: 1, y: 1, w: 1, h: 1 }; }, /熱區 "ZZ" 不是/],
    ['hotspot outside the image', (ev) => { ev.venue.map.regions.SO.w = 140; }, /0–100 的百分比/],
    ['missing image', (ev) => { ev.venue.images[1].src = 'assets/img/none.webp'; }, /找不到圖片/],
    ['favourite not in the schedule', (ev) => { ev.event.lottery.favorite = '不存在的團'; }, /lottery\.favorite/],
  ];
  for (const [name, breakIt, expected] of cases) {
    const ev = freshMp();
    breakIt(ev);
    const { errors } = validate(ev);
    assert.ok(errors.some((e) => expected.test(e)), `${name}: expected ${expected}, got ${JSON.stringify(errors)}`);
  }
});

/* ---------------- homepage (site/): see site.test.mjs ---------------- */
test('site and home are kept for the homepage and cannot be event names', () => {
  for (const name of ['site', 'home']) {
    const ev = fresh();
    ev.slug = name;
    ev.event.slug = name;
    assert.ok(validate(ev).errors.some((e) => /留給首頁/.test(e)), name);
  }
});

test('deploy.yml offers every event and the homepage, and each has its wrangler config', () => {
  const yml = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  const options = [...yml.match(/options:\n((?:\s+- .+\n)+)/)[1].matchAll(/- (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(options.sort(), [...listEvents(), 'site'].sort());
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  for (const slug of listEvents()) assert.ok(fs.existsSync(path.join(root, 'events', slug, 'wrangler.jsonc')), slug);
  const site = fs.readFileSync(path.join(root, 'site', 'wrangler.jsonc'), 'utf8');
  // One route for the whole host (a route pattern cannot hold a query string, so this is how /?fbclid=… is caught);
  // the homepage file answers /, and the script hands everything else on unchanged.
  assert.deepEqual([...site.matchAll(/"pattern": "([^"]+)"/g)].map((m) => m[1]), ['chiparashi.tw/*']);
  assert.match(site, /"main": "worker\.js"/);
  assert.doesNotMatch(site, /run_worker_first/, 'files first, the script only for paths with no file');
});

test('the homepage script hands every request it gets on to the origin unchanged', async () => {
  const worker = (await import('../site/worker.js')).default;
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (req) => { seen.push(req); return new Response('origin', { status: 200 }); };
  try {
    const req = new Request('https://chiparashi.tw/favicon.ico?x=1', { headers: { 'x-test': '1' } });
    const res = await worker.fetch(req, {}, {});
    assert.equal(await res.text(), 'origin');
    assert.equal(seen.length, 1);
    assert.equal(seen[0], req, 'the same request object, untouched');
  } finally { globalThis.fetch = real; }
});

/* ---------------- recommended songs (one per platform) ---------------- */
test('players: one song on Spotify and Apple Music, next to the artist-wide players', () => {
  const ctx = { window: {}, navigator: { onLine: true } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'core', 'embed.js'), 'utf8'), ctx);
  const { src, label } = ctx.window.FP_EMBED;
  assert.equal(src('spotifyTrack', '0HxFauxKj5X1DIujxM404U', true), 'https://open.spotify.com/embed/track/0HxFauxKj5X1DIujxM404U?utm_source=generator&theme=0');
  assert.equal(src('appleMusicSong', '1470902108?i=1470902109', false), 'https://embed.music.apple.com/tw/album/1470902108?i=1470902109&app=music&theme=light');
  assert.equal(src('spotify', '6c4IBMTcnFDhsKHXNSBBvp', true), 'https://open.spotify.com/embed/artist/6c4IBMTcnFDhsKHXNSBBvp?utm_source=generator&theme=0');
  assert.deepEqual(['spotifyTrack', 'appleMusicSong', 'youtube'].map(label), ['Spotify', 'Apple Music', 'YouTube']);
});

test('validate checks song picks: ID formats, one player per platform, a reason and source each, a different song per platform', () => {
  const base = () => {
    const ev = fresh();
    ev.event.rules = { ...(ev.event.rules || {}), picks: true };
    const a = ev.artists['拍謝少年'];
    a.embeds = { spotifyTrack: '0HxFauxKj5X1DIujxM404U', appleMusicSong: '1470902108?i=1470902109', youtube: 'dQw4w9WgXcQ' };
    const note = (title) => ({ title, why: '官方介紹點名的代表作', sources: ['https://www.vagabondfest.com/blog/posts/x'] });
    a.picks = { spotifyTrack: note('暗流'), appleMusicSong: note('撐'), youtube: note('歹勢好勢') };
    return ev;
  };
  assert.deepEqual(validate(base()).errors, []);
  const cases = [
    ['bad spotify track id', (a) => { a.embeds.spotifyTrack = 'nope'; }, /spotifyTrack 的 ID "nope" 格式不對/],
    ['bad apple song id', (a) => { a.embeds.appleMusicSong = '1470902109'; }, /appleMusicSong 的 ID "1470902109" 格式不對/],
    ['two Spotify players', (a) => { a.embeds.spotify = '6c4IBMTcnFDhsKHXNSBBvp'; }, /Spotify 只能放一個播放器/],
    ['no note for a player', (a) => { delete a.picks.youtube; }, /youtube 要有推薦的歌名、理由和來源/],
    ['note without a reason', (a) => { a.picks.youtube.why = ''; }, /youtube 要有推薦的歌名、理由和來源/],
    ['note without a source', (a) => { a.picks.youtube.sources = []; }, /youtube 要有推薦的歌名、理由和來源/],
    ['note for a missing player', (a) => { a.picks.spotify = a.picks.youtube; }, /picks 裡的 "spotify" 沒有對應的播放器/],
    ['same song on two platforms', (a) => { a.picks.youtube.title = '暗流 (Official Music Video)'; }, /「暗流」放在兩個平台/],
  ];
  for (const [name, breakIt, expected] of cases) {
    const ev = base();
    breakIt(ev.artists['拍謝少年']);
    const { errors } = validate(ev);
    assert.ok(errors.some((e) => expected.test(e)), `${name}: expected ${expected}, got ${JSON.stringify(errors)}`);
  }
});

test('the page gets the players but not the pick notes (they are for review, not for download)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-picks-'));
  process.env.FP_BUILD = 'picks-test';
  try { build('vagabond2026', { out, artifactOut: out + '-art' }); } finally { delete process.env.FP_BUILD; }
  const data = fs.readFileSync(path.join(out, 'vagabond2026', 'data.js'), 'utf8');
  assert.doesNotMatch(data, /"picks":/);
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(out + '-art', { recursive: true, force: true });
});
