#!/usr/bin/env node
// Checks an event's data before it is built or deployed.
//   node scripts/validate.mjs            → every event under events/
//   node scripts/validate.mjs <slug>     → one event
// Exits 1 when there is any error. Warnings and notes are printed but do not fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const LINK_PATTERNS = {
  spotify: /^https:\/\/open\.spotify\.com\/artist\/[A-Za-z0-9]{22}$/,
  apple: /^https:\/\/music\.apple\.com\/[a-z]{2}\/artist\/([^/?#]+\/)?\d+$/,
  youtube: /^https:\/\/www\.youtube\.com\/(channel\/UC[\w-]{22}|@[^/?#\s]+)$/,
};
// Streaming IDs for the in-card player (features.embeds): what each platform's ID looks like.
const EMBED_PATTERNS = {
  spotify: /^[A-Za-z0-9]{22}$/,
  spotifyTrack: /^[A-Za-z0-9]{22}$/,
  spotifyPodcast: /^[A-Za-z0-9]{22}$/,
  appleMusic: /^\d+$/,
  appleMusicSong: /^\d+\?i=\d+$/,
  youtube: /^[A-Za-z0-9_-]{11}$/,
  streetvoice: /^\d+$/,
};
// Hosts that never count as a source for a bio (see CLAUDE.md).
const NOT_A_SOURCE = /(^|\.)last\.fm$/;

export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
// "A ft. B" and "A × B" are separate artists; the same split runs in core/app.js.
export const splitArtists = (name) => name.split(/\s+(?:ft\.|×)\s+/).map((a) => a.trim()).filter(Boolean);

export function loadEvent(slug) {
  const dir = path.join(ROOT, 'events', slug);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const opt = (f, empty) => (fs.existsSync(path.join(dir, f)) ? read(f) : empty);
  // An event announced by name only ("status": "tba") has no timetable files yet.
  return { slug, dir, event: read('event.json'), schedule: opt('data/schedule.json', []), artists: opt('data/artists.json', {}), venue: opt('data/venue.json', null) };
}

export function listEvents() {
  return fs.readdirSync(path.join(ROOT, 'events'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(ROOT, 'events', d.name, 'event.json')))
    .map((d) => d.name);
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function validate({ slug, dir, event: ev, schedule, artists, venue }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  /* ---------- event.json ---------- */
  if (ev.slug !== slug) err(`event.json: slug "${ev.slug}" 跟資料夾名稱 "${slug}" 不一樣`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) err(`活動代號 "${slug}" 只能用小寫英文、數字與連字號`);
  // Reserved for the homepage: "site" is its build and deploy name, "home" its Worker (fp-home).
  if (['site', 'home'].includes(slug)) err(`活動代號不能叫 "${slug}"，這個名字留給首頁`);
  // Each event is served at <slug>* — a slug that starts another one would take over its paths.
  for (const other of listEvents()) {
    if (other !== slug && (other.startsWith(slug) || slug.startsWith(other))) err(`活動代號 "${slug}" 和 "${other}" 開頭相同，網址會互相蓋到，換一個代號`);
  }
  // Announced by name only: one page that says the details are on the way (see CLAUDE.md, "status": "tba").
  if (ev.status !== undefined && ev.status !== 'tba') err(`event.json: status 只能是 "tba"（還沒公布日期與時間表），或不寫`);
  if (ev.status === 'tba') {
    for (const k of ['name', 'shortName', 'lang', 'notice']) if (!ev[k]) err(`event.json: 缺少 ${k}（status tba 的頁面要用）`);
    if (!ev.theme?.dark?.bg || !ev.theme?.light?.bg) err('event.json: theme 要有 dark 與 light（至少 bg）');
    if ((schedule || []).length || (ev.days || []).length) err('event.json: 有日期或時間表就不是 tba 了，把 status 拿掉再補完整資料');
    return { errors, warnings, notes: ['待官方資訊公布：只產生一頁說明'] };
  }
  for (const k of ['name', 'shortName', 'lang', 'timezone', 'dataDate', 'sourceNote']) if (!ev[k]) err(`event.json: 缺少 ${k}`);
  if (ev.dataDate && !DATE.test(ev.dataDate)) err(`event.json: dataDate "${ev.dataDate}" 要是 YYYY-MM-DD`);
  try { new Intl.DateTimeFormat('en', { timeZone: ev.timezone }); } catch { err(`event.json: 時區 "${ev.timezone}" 無效`); }
  if (!Array.isArray(ev.days) || !ev.days.length) err('event.json: days 不能是空的');
  (ev.days || []).forEach((d, i) => {
    const at = `event.json days[${i}]`;
    if (!DATE.test(d.date || '')) err(`${at}: date "${d.date}" 要是 YYYY-MM-DD`);
    if (!HHMM.test(d.start || '') || !HHMM.test(d.end || '')) err(`${at}: start／end 要是 HH:MM`);
    else if (toMin(d.start) >= toMin(d.end)) err(`${at}: start 要早於 end`);
    if (!d.label) err(`${at}: 缺少 label`);
  });
  const stageIds = new Set();
  (ev.stages || []).forEach((s, i) => {
    const at = `event.json stages[${i}]`;
    if (!/^[A-Za-z0-9]+$/.test(s.id || '')) err(`${at}: id "${s.id}" 只能用英文或數字`);
    if (stageIds.has(s.id)) err(`${at}: 舞台 id "${s.id}" 重複`);
    stageIds.add(s.id);
    if (!s.name) err(`${at}: 缺少 name`);
    if (!HEX.test(s.color?.dark || '') || !HEX.test(s.color?.light || '')) err(`${at}: color.dark／color.light 要是 #RRGGBB`);
  });
  if (!stageIds.size) err('event.json: stages 不能是空的');
  for (const mode of ['dark', 'light']) if (!ev.theme?.[mode]) err(`event.json: 缺少 theme.${mode}`);
  for (const k of ['dark', 'light']) {
    const keysA = Object.keys(ev.theme?.dark || {}).sort().join();
    const keysB = Object.keys(ev.theme?.[k] || {}).sort().join();
    if (keysA !== keysB) { err('event.json: theme.dark 和 theme.light 的 token 要一樣多、名稱一樣'); break; }
  }
  const site = ev.urls?.site || '';
  if (!/^https:\/\/[^/]+\/.+\/$/.test(site)) err('event.json: urls.site 要是 https 開頭、斜線結尾的網址');
  else if (!site.endsWith(`/${slug}/`)) err(`event.json: urls.site 要以 /${slug}/ 結尾`);
  if (ev.urls?.artifact && !/^https:\/\/claude\.ai\//.test(ev.urls.artifact)) warn('event.json: urls.artifact 看起來不是 claude.ai 的網址');
  const langs = ev.languages || ['zh'];
  if (langs.some((l) => !['zh', 'en'].includes(l))) err('event.json: languages 只支援 "zh"、"en"');
  if (langs.includes('en')) {
    for (const k of ['subtitleEn', 'sourceNoteEn']) if (!ev[k]) warn(`event.json: 有英文介面但缺少 ${k}`);
    (ev.stages || []).forEach((st) => { if (!st.en) warn(`event.json: 舞台 ${st.id} 缺少英文名 en`); });
  }
  for (const f of [ev.css, ev.fonts?.display?.file, ev.fonts?.mono?.file, ev.icons?.svg, ev.icons?.maskable, ...Object.values(ev.icons?.png || {})]) {
    if (f && !fs.existsSync(path.join(dir, f))) err(`event.json: 找不到檔案 ${f}`);
  }

  /* ---------- schedule.json ---------- */
  if (!Array.isArray(schedule)) { err('schedule.json 要是陣列'); return { errors, warnings, notes }; }
  const ids = new Set();
  const seqs = new Set();
  const byStage = new Map();
  schedule.forEach((s, i) => {
    const at = `schedule.json #${i} (${s.id || s.name || '?'})`;
    if (!/^d\d+-[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id || '')) err(`${at}: id 要像 d1-ano（d＋第幾天＋小寫代號）`);
    else if (!s.id.startsWith(`d${s.day}-`)) err(`${at}: id 開頭 d${s.id.match(/^d(\d+)/)[1]} 跟 day ${s.day} 不一致`);
    if (ids.has(s.id)) err(`${at}: id 重複`);
    ids.add(s.id);
    if (!Number.isInteger(s.seq) || s.seq < 0) err(`${at}: seq 要是 0 以上的整數`);
    else if (seqs.has(s.seq)) err(`${at}: seq ${s.seq} 重複（seq 永久不變、不能重用）`);
    seqs.add(s.seq);
    const day = ev.days?.[s.day - 1];
    if (!day) { err(`${at}: day ${s.day} 不在 event.json 的 days 裡`); return; }
    if (!stageIds.has(s.stage)) err(`${at}: 舞台 "${s.stage}" 不在 event.json 的 stages 裡`);
    if (!s.name || typeof s.name !== 'string') err(`${at}: 缺少 name`);
    for (const k of ['en', 'note']) if (typeof s[k] !== 'string') err(`${at}: ${k} 要是字串（沒有就寫 ""）`);
    if ('noteEn' in s && (typeof s.noteEn !== 'string' || !s.note)) err(`${at}: noteEn 要是字串，而且只在有 note 時才寫（官方英文版的講座標題）`);
    if (!HHMM.test(s.start || '') || !HHMM.test(s.end || '')) { err(`${at}: start／end 要是 HH:MM`); return; }
    const a = toMin(s.start);
    const b = toMin(s.end);
    if (a >= b) err(`${at}: 開始 ${s.start} 要早於結束 ${s.end}`);
    if (a < toMin(day.start) || b > toMin(day.end)) err(`${at}: ${s.start}–${s.end} 超出當天 ${day.start}–${day.end}`);
    const key = `${s.day}-${s.stage}`;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push({ s, a, b });
  });
  for (const list of byStage.values()) {
    list.sort((x, y) => x.a - y.a);
    for (let i = 1; i < list.length; i++) {
      if (list[i].a < list[i - 1].b) err(`schedule.json: ${list[i - 1].s.id} 和 ${list[i].s.id} 在同一個舞台時間重疊`);
    }
  }
  const maxSeq = Math.max(-1, ...seqs);
  if (seqs.size && maxSeq >= 512) warn('schedule.json: seq 超過 512，備份連結會變得很長');

  /* ---------- artists.json ---------- */
  const performers = new Set();
  for (const s of schedule) {
    performers.add(s.name);
    if (!s.note) splitArtists(s.name).forEach((a) => performers.add(a));
    (artists?.[s.name]?.members || []).forEach((m) => performers.add(m));
  }
  // Pages that read without JavaScript (features.pages): the organizer and venue go into the structured data, and
  // every artist with an intro or links gets a page at artists/<slug>/ — a web name that never changes once live.
  if (ev.features?.pages) {
    if (!ev.organizer?.name) err('event.json: features.pages 需要 organizer.name（主辦單位）');
    if (!ev.venue?.name) err('event.json: features.pages 需要 venue.name（場地）');
    const slugs = new Map();
    for (const [name, a] of Object.entries(artists || {})) {
      if (!a.bio && !Object.keys(a.links || {}).length) continue;
      if (!a.slug) { err(`artists.json "${name}": 有簡介或連結的藝人要有 slug（藝人頁網址，例如 sorry-youth）`); continue; }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug)) err(`artists.json "${name}": slug "${a.slug}" 只能用小寫英文、數字與連字號`);
      if (slugs.has(a.slug)) err(`artists.json "${name}": slug "${a.slug}" 跟 "${slugs.get(a.slug)}" 重複`);
      slugs.set(a.slug, name);
    }
  }
  const minSources = ev.rules?.minBioSources ?? 2;
  for (const [name, a] of Object.entries(artists || {})) {
    const at = `artists.json "${name}"`;
    if (typeof a.bio !== 'string') err(`${at}: bio 要是字串（沒有就寫 ""）`);
    if (!Array.isArray(a.sources)) err(`${at}: sources 要是陣列`);
    const sources = a.sources || [];
    for (const u of sources) if (!/^https:\/\//.test(u)) err(`${at}: 來源 ${u} 要是 https 網址`);
    const counted = new Set(sources.map(host).filter((h) => h && !NOT_A_SOURCE.test(h)));
    if (sources.some((u) => NOT_A_SOURCE.test(host(u)))) warn(`${at}: Last.fm 不算來源，只當參考`);
    if (a.bio) {
      if (counted.size < minSources) err(`${at}: 簡介至少要 ${minSources} 個不同網站的來源（現在 ${counted.size} 個）`);
      const minChars = ev.rules?.minBioChars ?? 40;
      if ([...a.bio].length < minChars) warn(`${at}: 簡介不到 ${minChars} 字，規則是改成留空`);
    }
    for (const [k, u] of Object.entries(a.links || {})) {
      if (!LINK_PATTERNS[k]) err(`${at}: 不支援的平台 "${k}"（只收 ${Object.keys(LINK_PATTERNS).join('、')}）`);
      else if (!LINK_PATTERNS[k].test(u)) err(`${at}: ${k} 連結 ${u} 不是藝人頁格式`);
    }
    for (const [k, id] of Object.entries(a.embeds || {})) {
      if (!EMBED_PATTERNS[k]) err(`${at}: 不支援的內嵌平台 "${k}"（只收 ${Object.keys(EMBED_PATTERNS).join('、')}）`);
      else if (!EMBED_PATTERNS[k].test(id)) err(`${at}: ${k} 的 ID "${id}" 格式不對`);
    }
    // One player per platform: a whole-artist player and a single song would show two tabs with the same name.
    if (a.embeds?.spotify && a.embeds?.spotifyTrack) err(`${at}: Spotify 只能放一個播放器（spotify 或 spotifyTrack 擇一）`);
    if (a.embeds?.appleMusic && a.embeds?.appleMusicSong) err(`${at}: Apple Music 只能放一個播放器（appleMusic 或 appleMusicSong 擇一）`);
    // Recommended songs (rules.picks): each player says which song, why it represents the artist, and where that comes from.
    const picks = a.picks || {};
    for (const k of Object.keys(picks)) if (!a.embeds?.[k]) err(`${at}: picks 裡的 "${k}" 沒有對應的播放器`);
    if (ev.rules?.picks) {
      for (const k of Object.keys(a.embeds || {})) {
        const p = picks[k];
        if (!p || !p.title || !p.why || !Array.isArray(p.sources) || !p.sources.length || !p.sources.every((u) => /^https:\/\//.test(u))) {
          err(`${at}: ${k} 要有推薦的歌名、理由和來源（picks.${k} 的 title、why、sources）`);
        }
      }
      // A different song on each platform; a live take or MV of the same song is the same song.
      const song = (t) => String(t).toLowerCase().replace(/[(（\[【「][^)）\]】」]*[)）\]】」]/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
      const seen = new Map();
      for (const [k, p] of Object.entries(picks)) {
        if (!p?.title) continue;
        const key = song(p.title);
        if (seen.has(key)) err(`${at}: 「${seen.get(key).title}」放在兩個平台（${seen.get(key).k}、${k}），每個平台要不同首`);
        else seen.set(key, { k, title: p.title });
      }
    }
    for (const m of a.members || []) if (!artists[m]) err(`${at}: members 裡的 "${m}" 在 artists.json 找不到`);
    if (!performers.has(name)) warn(`${at}: 沒有對應的演出，可能是名字拼法不一致`);
  }
  if (ev.lottery?.favorite && !schedule.some((s) => s.name === ev.lottery.favorite)) err(`event.json: lottery.favorite "${ev.lottery.favorite}" 不是任何一場演出的名稱`);

  /* ---------- venue.json (map hotspots, coordinates, official images) ---------- */
  if (venue) {
    const files = [venue.map?.image, venue.map?.imageEn, ...(venue.images || []).flatMap((i) => [i.src, i.srcEn])].filter(Boolean);
    for (const f of files) if (!fs.existsSync(path.join(dir, f))) err(`venue.json: 找不到圖片 ${f}`);
    for (const [id, r] of Object.entries(venue.map?.regions || {})) {
      if (!stageIds.has(id)) err(`venue.json: 熱區 "${id}" 不是 event.json 裡的舞台`);
      if (![r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && v >= 0 && v <= 100)) err(`venue.json: 熱區 ${id} 的 x／y／w／h 要是 0–100 的百分比`);
    }
    for (const [id, c] of Object.entries(venue.map?.locations || {})) {
      if (!stageIds.has(id)) err(`venue.json: 座標 "${id}" 不是 event.json 裡的舞台`);
      if (!(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180)) err(`venue.json: 座標 ${id} 的 lat／lng 不對`);
    }
    const noSpot = [...stageIds].filter((id) => !venue.map?.regions?.[id]);
    if (venue.map && noSpot.length) notes.push(`地圖上沒有熱區的舞台：${noSpot.join('、')}`);
  }
  const missing = [...performers].filter((p) => !artists?.[p]?.bio && !artists?.[p]?.members);
  if (missing.length) notes.push(`沒有簡介（畫面會顯示「目前沒有找到可靠的介紹資料」）：${missing.join('、')}`);
  notes.push(`${schedule.length} 場演出、${Object.keys(artists || {}).length} 位藝人資料、${Object.values(artists || {}).reduce((n, a) => n + Object.keys(a.links || {}).length, 0)} 個平台連結、${Object.values(artists || {}).reduce((n, a) => n + Object.keys(a.embeds || {}).length, 0)} 個試聽 ID`);
  return { errors, warnings, notes };
}

function main() {
  // `site` (the homepage) lists every event, so it checks them all.
  const slugs = process.argv[2] && process.argv[2] !== 'site' ? [process.argv[2]] : listEvents();
  let failed = false;
  for (const slug of slugs) {
    let res;
    try { res = validate(loadEvent(slug)); } catch (e) { res = { errors: [`讀不到活動資料：${e.message}`], warnings: [], notes: [] }; }
    console.log(`\n${slug}`);
    res.errors.forEach((m) => console.log(`  ✗ ${m}`));
    res.warnings.forEach((m) => console.log(`  ! ${m}`));
    res.notes.forEach((m) => console.log(`  · ${m}`));
    if (!res.errors.length) console.log('  ✓ 沒有錯誤');
    failed ||= res.errors.length > 0;
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
