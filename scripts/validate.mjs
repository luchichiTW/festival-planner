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
// The links an act's page on the festival site lists (lineup.json): what the artist card shows while only the lineup is out.
const LINEUP_LINKS = ['facebook', 'instagram', 'youtube', 'x', 'official'];
// An act's id: the last part of its page's address on the festival site (…/portfolio-item/the-hu/ → the-hu). It stays
// when the festival changes how the name is written, so the acts marked 想看 on the lineup page (core/lineup.js, kept
// on the visitor's phone by this id) still find their act, and later its sets.
export function lineupId(page) {
  try { return decodeURIComponent(new URL(page).pathname.split('/').filter(Boolean).pop() || '').toLowerCase(); } catch { return ''; }
}
// Names compared without case, spaces, punctuation or a tag like "[JP]".
const foldName = (s) => String(s || '').toLowerCase().replace(/\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
// Once the timetable is out, each act on the lineup → the ids of its sets: a set whose name or English name is the
// act's, or a set that names it with "lineup" (an id, or a list of ids for a set shared by several acts).
export function lineupSets(lineup, schedule) {
  const map = {};
  for (const a of lineup || []) {
    const id = lineupId(a.page);
    const names = new Set([foldName(a.name), foldName(a.en)].filter(Boolean));
    map[id] = (schedule || []).filter((s) => {
      if (s.lineup !== undefined) return [].concat(s.lineup).includes(id);
      return names.has(foldName(s.name)) || (!!s.en && names.has(foldName(s.en)));
    }).map((s) => s.id);
  }
  return map;
}
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
  // An event announced by name only ("status": "tba") has no timetable files yet; one with its lineup out
  // ("status": "lineup") has data/lineup.json.
  return { slug, dir, event: read('event.json'), schedule: opt('data/schedule.json', []), artists: opt('data/artists.json', {}), venue: opt('data/venue.json', null), lineup: opt('data/lineup.json', []) };
}

export function listEvents() {
  return fs.readdirSync(path.join(ROOT, 'events'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(ROOT, 'events', d.name, 'event.json')))
    .map((d) => d.name);
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// What the homepage (fp-home, dist-site/) serves at the top of chiparashi.tw. tests/site.test.mjs checks the list
// against the build.
export const HOME_PATHS = ['claude', 'privacy', 'icons', 'index.html', 'llms.txt', 'og.png', 'robots.txt', 'sitemap.xml', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png'];

// Intros, sources, platform links and players in artists.json; shared by the timetable and the lineup-only page.
// performers: the names that may have an entry; unknown: the warning for any other name; officialSite(name): the act's
// own website, for rules.bioSource "official".
function checkArtists({ ev, artists, performers, unknown, officialSite = () => '', err, warn }) {
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
      // rules.bioSource "official": the intro comes from the act's own website (the official link the festival lists).
      if (ev.rules?.bioSource === 'official') {
        const site = host(officialSite(name) || '');
        if (!site) err(`${at}: 這組沒有官方網站，規則是只從官方網站寫簡介，改成留空`);
        else if (!sources.length || sources.some((u) => host(u) !== site)) err(`${at}: 簡介的來源要是這組的官方網站（${site}）`);
      }
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
    if (!performers.has(name)) warn(`${at}: ${unknown}`);
  }
}

export function validate({ slug, dir, event: ev, schedule, artists, venue, lineup = [] }) {
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
  // An event is served at <slug>*: a slug that starts one of the homepage's own paths (/claude/, /privacy/, …) would take it over.
  const taken = HOME_PATHS.find((p) => p.startsWith(slug));
  if (taken) err(`活動代號 "${slug}" 會蓋到首頁的 /${taken}，換一個代號`);
  // Each event is served at <slug>* — a slug that starts another one would take over its paths.
  for (const other of listEvents()) {
    if (other !== slug && (other.startsWith(slug) || slug.startsWith(other))) err(`活動代號 "${slug}" 和 "${other}" 開頭相同，網址會互相蓋到，換一個代號`);
  }
  // Announced by name only: one page that says the details are on the way (see CLAUDE.md, "status": "tba").
  if (ev.status !== undefined && !['tba', 'lineup'].includes(ev.status)) err(`event.json: status 只能是 "tba"（還沒公布陣容與時間表）、"lineup"（陣容公布了、時間表還沒），或不寫`);
  if (ev.status === 'tba') {
    for (const k of ['name', 'shortName', 'lang', 'notice']) if (!ev[k]) err(`event.json: 缺少 ${k}（status tba 的頁面要用）`);
    if (ev.ticketNote !== undefined && (typeof ev.ticketNote !== 'string' || !ev.ticketNote.trim())) err('event.json: ticketNote（首頁票券上的副標）要是文字');
    if (!ev.theme?.dark?.bg || !ev.theme?.light?.bg) err('event.json: theme 要有 dark 與 light（至少 bg）');
    if ((schedule || []).length || (ev.days || []).length) err('event.json: 有日期或時間表就不是 tba 了，把 status 拿掉再補完整資料');
    return { errors, warnings, notes: ['待官方資訊公布：只產生一頁說明'] };
  }
  // Lineup out, timetable not yet: one page of the acts in the festival's order (see CLAUDE.md, "status": "lineup").
  if (ev.status === 'lineup') {
    for (const k of ['name', 'shortName', 'lang', 'dataDate', 'sourceNote']) if (!ev[k]) err(`event.json: 缺少 ${k}（status lineup 的頁面要用）`);
    if (ev.dataDate && !DATE.test(ev.dataDate)) err(`event.json: dataDate "${ev.dataDate}" 要是 YYYY-MM-DD`);
    if (!ev.theme?.dark?.bg || !ev.theme?.light?.bg) err('event.json: theme 要有 dark 與 light（至少 bg）');
    if (!/^https:\/\/[^/]+\/.+\/$/.test(ev.urls?.site || '') || !ev.urls.site.endsWith(`/${slug}/`)) err(`event.json: urls.site 要是 https 開頭、以 /${slug}/ 結尾的網址`);
    if (!/^https:\/\//.test(ev.urls?.lineup || '')) err('event.json: urls.lineup 要是官方陣容頁的 https 網址（陣容從那裡更新）');
    if ((schedule || []).length || (ev.days || []).length) err('event.json: 有日期或時間表就不是 lineup 了，把 status 拿掉再補完整資料');
    if (!Array.isArray(lineup) || !lineup.length) err('lineup.json: 陣容至少要有一組（lineup 是官方陣容頁上的順序）');
    const lineupHost = host(ev.urls?.lineup || '');
    const seen = new Set();
    const pages = new Set();
    (Array.isArray(lineup) ? lineup : []).forEach((a, i) => {
      const at = `lineup.json [${i}]${a?.name ? ` "${a.name}"` : ''}`;
      if (!a?.name || typeof a.name !== 'string') { err(`${at}: 缺少 name`); return; }
      if (seen.has(a.name)) err(`${at}: 名稱重複`);
      seen.add(a.name);
      if (a.en !== undefined && (typeof a.en !== 'string' || !a.en.trim())) err(`${at}: en（官方英文名）要是文字，沒有就不寫`);
      if (!/^https:\/\//.test(a.page || '') || host(a.page) !== lineupHost) err(`${at}: page 要是這組在官網（${lineupHost}）上的頁面`);
      else if (!lineupId(a.page)) err(`${at}: page 的網址最後要有這組的代號（想看用它記）`);
      else if (pages.has(lineupId(a.page))) err(`${at}: page 跟前面的組重複（想看用 page 網址最後一段記，每組要不一樣）`);
      pages.add(lineupId(a.page));
      for (const [k, u] of Object.entries(a.links || {})) {
        if (!LINEUP_LINKS.includes(k)) err(`${at}: 連結 "${k}" 不是官方頁會列的種類（只收 ${LINEUP_LINKS.join('、')}）`);
        else if (!/^https:\/\/[^\s]+$/.test(u)) err(`${at}: ${k} 連結 ${u} 要是 https 網址`);
      }
    });
    // The card on top: try a past event's real timetable (event.json "demo": its slug), with pictures of its board.
    if (ev.demo !== undefined) {
      const demoFile = path.join(ROOT, 'events', String(ev.demo), 'event.json');
      const demo = fs.existsSync(demoFile) ? JSON.parse(fs.readFileSync(demoFile, 'utf8')) : null;
      if (!demo) err(`event.json: demo "${ev.demo}" 要是 events/ 底下的活動`);
      else if (demo.status) err(`event.json: demo "${ev.demo}" 要是有時間表的活動（排團工具），不是 ${demo.status} 頁`);
      else for (const f of ['board-light.webp', 'board-dark.webp']) if (!fs.existsSync(path.join(ROOT, 'events', ev.demo, 'assets', f))) err(`event.json: demo 需要 events/${ev.demo}/assets/${f}（node scripts/board.mjs ${ev.demo}）`);
    }
    const official = new Map((Array.isArray(lineup) ? lineup : []).map((a) => [a?.name, a?.links?.official]));
    checkArtists({ ev, artists, performers: seen, unknown: '不在陣容裡，可能是名字拼法不一致', officialSite: (n) => official.get(n), err, warn });
    const withBio = [...seen].filter((n) => artists?.[n]?.bio).length;
    return { errors, warnings, notes: [`陣容公布、時間表還沒：${seen.size} 組，${withBio} 組有簡介`] };
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
  // The two lines right of the wordmark (date over place); the year then leaves the wordmark.
  if (ev.header !== undefined && (!ev.header?.date || !ev.header?.place)) err('event.json: header 要有 date 和 place（標題右邊的兩行）');
  // iPhone Safari's 加入主畫面 steps as pictures (core/a2hs.js), in order. iOS 27: 長按網址, 分享, 檢視較多, 加入主畫面,
  // 加入. Before iOS 27 (iosInstallStepsBefore27): ⋯ on the right of the address bar first, then the same four.
  for (const [k, first] of [['iosInstallSteps', '長按網址'], ['iosInstallStepsBefore27', '⋯']]) {
    if (ev[k] === undefined) continue;
    if (!Array.isArray(ev[k]) || ev[k].length !== 5) err(`event.json: ${k} 要是 5 張圖，照順序：${first}、分享、檢視較多、加入主畫面、加入`);
    else for (const f of ev[k]) if (!/\.(webp|png|jpe?g)$/i.test(f) || !fs.existsSync(path.join(dir, f))) err(`event.json: ${k} 找不到圖片 ${f}`);
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
    if (s.lineup !== undefined) {
      const known = new Set((lineup || []).map((a) => lineupId(a.page)));
      for (const id of [].concat(s.lineup)) if (typeof id !== 'string' || !known.has(id)) err(`${at}: lineup "${id}" 不在 lineup.json 裡（用那一組 page 網址的最後一段）`);
    }
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

  // The lineup page's acts (kept after the timetable is out): each needs a set, or its 想看 marks would be lost.
  if (Array.isArray(lineup) && lineup.length) {
    const sets = lineupSets(lineup, schedule);
    for (const a of lineup) if (!sets[lineupId(a.page)]?.length) err(`lineup.json "${a.name}"：時間表裡找不到這組（名稱或英文名對不上），在 schedule.json 那一場加 "lineup": "${lineupId(a.page)}"`);
  }

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
  checkArtists({ ev, artists, performers, unknown: '沒有對應的演出，可能是名字拼法不一致', officialSite: () => '', err, warn });
  if (ev.lottery?.favorite && !schedule.some((s) => s.name === ev.lottery.favorite)) err(`event.json: lottery.favorite "${ev.lottery.favorite}" 不是任何一場演出的名稱`);

  /* ---------- venue.json (map hotspots, coordinates, official images) ---------- */
  if (venue) {
    const files = [venue.map?.image, venue.map?.imageEn, ...[...(venue.images || []), ...(venue.info || [])].flatMap((i) => [i.src, i.srcEn])].filter(Boolean);
    for (const f of files) if (!fs.existsSync(path.join(dir, f))) err(`venue.json: 找不到圖片 ${f}`);
    for (const im of venue.info || []) if (!im.label || !im.src) err('venue.json: info 每一張都要有 label 和 src');
    for (const im of venue.images || []) {
      if (!im.label || !im.src) err('venue.json: images 每一張都要有 label 和 src');
      if (im.day !== undefined && !(Number.isInteger(im.day) && im.day >= 1 && im.day <= (ev.days || []).length)) err(`venue.json: 圖片「${im.label}」的 day 要是 1 到 ${(ev.days || []).length}`);
    }
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
