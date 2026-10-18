#!/usr/bin/env node
// Checks every in-card player of an event against the platforms themselves (needs the network; not part of npm test):
//   node scripts/check-embeds.mjs <slug> [--json <file>]
// - the song, album or video exists and can be embedded on other sites;
// - it belongs to the artist: same Spotify artist, Apple Music artist or YouTube channel as the verified "links"
//   (a video on another channel, e.g. the label's, is reported for review);
// - the title on the platform matches picks.<key>.title when there is one.
// Exit code 1 when something is wrong; warnings are listed for a person to look at.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEvent } from './validate.mjs';

const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'accept-language': 'en' };
const get = async (url, opts = {}) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: UA, ...opts }).catch((e) => ({ ok: false, status: 0, error: e }));
    if (r.status !== 429 && r.status !== 0) return r;
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return { ok: false, status: 429 };
};
const text = async (url) => { const r = await get(url); return r.ok ? r.text() : ''; };
const json = async (url) => { const r = await get(url); return r.ok ? r.json() : null; };
// Loose title match: lower case, no spaces or punctuation; either contains the other. Video titles often carry the
// song inside brackets (【神岡】, 「c r a z y」), so compare with the brackets' contents kept and with them dropped.
const squash = (t) => String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const unbracket = (t) => String(t || '').replace(/[(（\[【「][^)）\]】」]*[)）\]】」]/g, '');
const sameTitle = (a, b) => [[squash(a), squash(b)], [squash(unbracket(a)), squash(unbracket(b))]]
  .some(([x, y]) => !!x && !!y && (x.includes(y) || y.includes(x)));

const idFrom = {
  spotify: (u) => (u || '').match(/\/artist\/([A-Za-z0-9]{22})/)?.[1],
  apple: (u) => (u || '').match(/\/(\d+)(?:\?.*)?$/)?.[1],
};
const channelCache = new Map();
async function channelOf(url) {
  if (!url) return null;
  const direct = url.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (direct) return direct[1];
  if (!channelCache.has(url)) channelCache.set(url, text(url).then((h) => h.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] || null));
  return channelCache.get(url);
}
const appleSongsCache = new Map();
function appleSongs(artistId) {
  if (!appleSongsCache.has(artistId)) {
    appleSongsCache.set(artistId, json(`https://itunes.apple.com/lookup?id=${artistId}&entity=song&country=tw&limit=200`)
      .then((d) => new Set((d?.results || []).filter((r) => r.wrapperType === 'track').map((r) => String(r.trackId)))));
  }
  return appleSongsCache.get(artistId);
}

async function check(name, entry, key, id) {
  const pick = entry.picks?.[key];
  const out = { name, key, id, want: pick?.title || '', errors: [], warnings: [], got: '', by: '' };
  const err = (m) => out.errors.push(m);
  const warn = (m) => out.warnings.push(m);
  if (key === 'spotifyTrack' || key === 'spotify') {
    const kind = key === 'spotify' ? 'artist' : 'track';
    const o = await json(`https://open.spotify.com/oembed?url=https://open.spotify.com/${kind}/${id}`);
    if (!o) { err(`Spotify 找不到這個 ${kind}`); return out; }
    out.got = String(o.title || '').replace(/^Spotify Embed: /, '');
    if (kind === 'track') {
      const artist = idFrom.spotify(entry.links?.spotify);
      const page = await text(`https://open.spotify.com/embed/track/${id}`);
      const artists = [...new Set([...page.matchAll(/spotify:artist:([A-Za-z0-9]{22})/g)].map((m) => m[1]))];
      out.by = artists.join(',');
      if (artist && !artists.includes(artist)) err(`不是這位藝人的歌（Spotify 藝人 ${artists.join('、') || '不明'}，連結是 ${artist}）`);
      if (!artist) warn('沒有 Spotify 藝人連結可以比對');
    }
  } else if (key === 'appleMusicSong' || key === 'appleMusic') {
    const [album, song] = String(id).split('?i=');
    const d = await json(`https://itunes.apple.com/lookup?id=${song || album}&country=tw`);
    const r = d?.results?.[0];
    if (!r) { err('Apple Music（台灣）找不到'); return out; }
    out.got = key === 'appleMusic' ? r.collectionName : r.trackName;
    out.by = r.artistName;
    if (song && String(r.collectionId) !== album) err(`歌曲不在這張專輯（實際在 ${r.collectionId}）`);
    const artist = idFrom.apple(entry.links?.apple);
    if (artist && String(r.artistId) !== artist) {
      if (song && (await appleSongs(artist)).has(String(song))) warn(`主要演出者是 ${r.artistName}，這位藝人是合作者`);
      else err(`不是這位藝人的作品（Apple Music 演出者 ${r.artistName}）`);
    }
  } else if (key === 'youtube') {
    const o = await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
    if (!o.ok) { err(o.status === 401 || o.status === 403 ? '影片不允許嵌入其他網站' : `影片打不開（${o.status}）`); return out; }
    const meta = await o.json();
    out.got = meta.title;
    out.by = meta.author_name;
    const want = await channelOf(entry.links?.youtube);
    const page = await text(`https://www.youtube.com/watch?v=${id}`);
    const ch = page.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)?.[1];
    if (want && ch && ch !== want) warn(`不在藝人自己的頻道，在「${meta.author_name}」`);
    if (!want) warn('沒有 YouTube 頻道連結可以比對');
  } else {
    return null; // podcasts and StreetVoice: nothing to compare against
  }
  if (pick?.title && out.got && !sameTitle(pick.title, out.got)) warn(`平台上的名稱是「${out.got}」，picks 寫「${pick.title}」`);
  return out;
}

export async function checkEmbeds(slug) {
  const { artists } = loadEvent(slug);
  const jobs = Object.entries(artists).flatMap(([name, a]) => Object.entries(a.embeds || {}).map(([k, id]) => () => check(name, a, k, id)));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) { const r = await jobs[next++](); if (r) results.push(r); }
  }));
  return results.sort((x, y) => x.name.localeCompare(y.name) || x.key.localeCompare(y.key));
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--json');
  if (!slug) { console.error('用法：node scripts/check-embeds.mjs <活動代號> [--json <檔案>]'); process.exit(2); }
  const results = await checkEmbeds(slug);
  for (const r of results) {
    const mark = r.errors.length ? '✗' : r.warnings.length ? '!' : '✓';
    console.log(`${mark} ${r.name} · ${r.key} · ${r.got || r.id}${r.by ? `（${r.by}）` : ''}`);
    r.errors.forEach((m) => console.log(`    ✗ ${m}`));
    r.warnings.forEach((m) => console.log(`    ! ${m}`));
  }
  const bad = results.filter((r) => r.errors.length).length;
  console.log(`\n${results.length} 個播放器：${results.length - bad} 個可用，${bad} 個有錯，${results.filter((r) => r.warnings.length).length} 個要人看`);
  const j = args.indexOf('--json');
  if (j >= 0 && args[j + 1]) fs.writeFileSync(args[j + 1], JSON.stringify(results, null, 2));
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
