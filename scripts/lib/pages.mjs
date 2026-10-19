// Pages that read without JavaScript, for events with features.pages: the timetable as text inside the app page,
// one page per artist with an intro or links, the "make your own with Claude" page, and what goes with them —
// per-page metadata, schema.org structured data (JSON-LD), a Markdown copy of each page, sitemap.xml and the
// _headers rules that point each page to its Markdown copy. Search engines, link previews, screen readers and
// assistants that fetch a page without running scripts get the same facts the app shows.
import fs from 'node:fs';
import path from 'node:path';
import { faqJsonLd, webAppJsonLd, staticAbout, PRIVACY_PATH } from './copy.mjs';

const DOW = '日一二三四五六';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// JSON that is safe inside a <script> element.
const ld = (v) => JSON.stringify(v, null, 0).replace(/</g, '\\u003c');
const split = (name) => name.split(/\s+(?:ft\.|×)\s+/).map((a) => a.trim()).filter(Boolean);
const mdEsc = (s) => String(s ?? '').replace(/([\\`*_[\]<>|])/g, '\\$1');
const ymd = (iso) => iso.replace(/-/g, '/');
const md = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };
const dow = (iso) => { const [y, m, d] = iso.split('-').map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const PLAT = { spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube' };
const PICK = { spotifyTrack: 'Spotify', appleMusicSong: 'Apple Music', youtube: 'YouTube' };
const pickURL = (k, id) => (k === 'spotifyTrack' ? `https://open.spotify.com/track/${id}`
  : k === 'appleMusicSong' ? `https://music.apple.com/tw/album/${id.split('?i=')[0]}?i=${id.split('?i=')[1]}`
    : `https://www.youtube.com/watch?v=${id}`);

// The prompt on the Claude page (and in the README): paste it into Claude with another festival's timetable image.
export function claudePrompt(ev) {
  const base = ev.urls.site;
  const repo = ev.urls.repo || 'https://github.com/luchichiTW/festival-planner';
  const raw = `${repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/events/${ev.slug}/artifact/index.html`;
  return `請讀 ${base}claude/ ，照上面的做法，幫我做一個音樂祭排團工具的 artifact：
1. 用那頁連到的單檔（${raw}）當起點，保留時間表、我的團序、撞團抽籤、搜尋與藝人介紹這些功能。
2. 把活動換成「（活動名稱）」，時間表照我附上的官方時間表圖片逐格轉，格式跟 ${base}data/schedule.json 一樣。
3. 發佈成 artifact，開 db 和 user 能力，讓每個人的團序存在自己的帳號裡。`;
}

export function claudePromptEn(ev) {
  const base = ev.urls.site;
  const repo = ev.urls.repo || 'https://github.com/luchichiTW/festival-planner';
  const raw = `${repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/events/${ev.slug}/artifact/index.html`;
  return `Read ${base}claude/ and follow it to build a festival planner artifact for me:
1. Start from the single file it links (${raw}) and keep the timetable, my schedule, the clash draw, search and the artist intros.
2. Switch the festival to "(festival name)" and convert the official timetable image I attach, cell by cell, into the same format as ${base}data/schedule.json.
3. Publish it as an artifact with the db and user capabilities, so each person's picks are saved to their own account.`;
}

export function hasPage(a) { return !!(a && a.slug && (a.bio || Object.keys(a.links || {}).length)); }

export function makePages({ ev, schedule, artists, site, out, pageCSS }) {
  const base = ev.urls.site;
  const stage = (id) => ev.stages.find((s) => s.id === id);
  const dayOf = (s) => ev.days[s.day - 1];
  const dayLabel = (d) => `${d.label}・${md(d.date)}（${dow(d.date)}）`;
  const when = (s) => `${dayLabel(dayOf(s))} ${s.start}–${s.end}`;
  const iso = (s, t) => `${dayOf(s).date}T${t}:00+08:00`;
  const people = (s) => (s.note ? (artists[s.name] ? [s.name] : []) : split(s.name));
  const enOf = (name) => {
    for (const s of schedule) { const i = split(s.name).indexOf(name); const en = split(s.en || '')[i]; if (i >= 0 && en && en !== name) return en; }
    return '';
  };
  const showsOf = (name) => schedule.filter((s) => people(s).includes(name)).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  const dataDate = ymd(ev.dataDate);
  const official = ev.organizer?.url || ev.urls.official;
  const unofficial = `時間表資料：${ev.shortName}官方公告 ${dataDate}・非官方排團工具，演出異動以主辦方現場公告為準。`;
  const repo = ev.urls.repo || 'https://github.com/luchichiTW/festival-planner';
  const rawArtifact = `${repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/events/${ev.slug}/artifact/index.html`;
  const claudeMd = `${repo}/blob/main/events/${ev.slug}/CLAUDE.md`;
  const pages = []; // { path, title } for the sitemap

  /* ---------- structured data ---------- */
  const festId = `${base}#festival`;
  const place = (name) => ({
    '@type': 'Place', name,
    address: { '@type': 'PostalAddress', addressLocality: ev.venue.locality, addressRegion: ev.venue.region, addressCountry: ev.venue.country },
  });
  const organizer = { '@type': 'Organization', name: ev.organizer.name, url: ev.organizer.url };
  const performer = (name, talk) => {
    const a = artists[name];
    const links = Object.values(a?.links || {});
    return { '@type': talk ? 'Person' : 'MusicGroup', name, ...(hasPage(a) ? { url: `${base}artists/${a.slug}/` } : {}), ...(links.length ? { sameAs: links } : {}) };
  };
  const showLd = (s) => {
    const first = artists[people(s)[0]];
    return {
      '@type': s.note ? 'Event' : 'MusicEvent',
      identifier: s.id,
      name: s.note ? `${s.note}（${s.name}）` : s.name,
      startDate: iso(s, s.start), endDate: iso(s, s.end),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: place(`${ev.shortName} ${stage(s.stage).name}・${ev.venue.name}`),
      performer: people(s).map((n) => performer(n, !!s.note)),
      organizer,
      superEvent: { '@id': festId },
      url: hasPage(first) ? `${base}artists/${first.slug}/` : `${base}#show-${s.id}`,
    };
  };
  const festival = (withShows) => ({
    '@type': 'Festival', '@id': festId, name: ev.name, ...(ev.nameEn ? { alternateName: ev.nameEn } : {}),
    url: official, startDate: ev.days[0].date, endDate: ev.days.at(-1).date,
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: place(ev.venue.name), organizer,
    ...(ev.urls.tickets ? { offers: { '@type': 'Offer', url: ev.urls.tickets } } : {}),
    ...(withShows ? { subEvent: schedule.map(showLd) } : {}),
  });
  const webPage = (p, name, description, extra = {}) => ({
    '@type': 'WebPage', '@id': `${base}${p}#page`, url: base + p, name, description, inLanguage: ev.lang, dateModified: ev.dataDate,
    isPartOf: { '@type': 'WebSite', name: 'chiparashi', url: new URL('/', base).href }, ...extra,
  });

  /* ---------- page head: title, description, canonical, preview, Markdown copy, JSON-LD ---------- */
  const head = (p, title, description, graph) => [
    `<link rel="canonical" href="${base + p}">`,
    '<link rel="alternate" type="text/markdown" href="index.md">',
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(ev.name)} 排團工具">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${base + p}">`,
    `<meta property="og:image" content="${base}og.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="zh_TW">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<script type="application/ld+json">${ld({ '@context': 'https://schema.org', '@graph': graph })}</script>`,
  ].join('\n');

  /* ---------- the app page: the timetable as text, for readers without JavaScript ---------- */
  const nameHTML = (s) => {
    if (s.note) {
      const a = artists[s.name];
      return `${esc(s.note)}（${hasPage(a) ? `<a href="artists/${a.slug}/">${esc(s.name)}</a>` : esc(s.name)}）`;
    }
    const parts = s.name.split(/(\s+(?:ft\.|×)\s+)/);
    return parts.map((x) => { const a = artists[x.trim()]; return hasPage(a) ? `<a href="artists/${a.slug}/">${esc(x)}</a>` : esc(x); }).join('');
  };
  const staticBlock = [
    '<section class="static" id="static" aria-label="文字版時間表">',
    `  <h2>${esc(ev.name)} 時間表</h2>`,
    `  <p>${esc(ev.subtitle || '')}。${esc(unofficial)}</p>`,
    ...ev.days.map((d, i) => [
      `  <div class="static-day"><h3>${esc(dayLabel(d))}</h3>`,
      ...ev.stages.filter((st) => schedule.some((s) => s.day === i + 1 && s.stage === st.id)).map((st) => [
        `    <div class="static-stage"><h4>${esc(st.name)}</h4><ul>`,
        ...schedule.filter((s) => s.day === i + 1 && s.stage === st.id).sort((a, b) => a.start.localeCompare(b.start))
          .map((s) => `      <li id="show-${s.id}"><time datetime="${iso(s, s.start)}">${s.start}–${s.end}</time> ${nameHTML(s)}</li>`),
        '    </ul></div>',
      ].join('\n')),
      '  </div>',
    ].join('\n')),
    staticAbout(),
    `  <p><a href="claude/">用 Claude 做你自己的排團工具</a>・<a href="${PRIVACY_PATH}">隱私說明</a>・<a href="${esc(official)}">${esc(ev.shortName)}官方網站</a></p>`,
    '</section>',
    '<!-- /static -->',
  ].join('\n');
  const appTitle = `${ev.name} 排團工具：時間表、我的團序、撞團抽籤（非官方）`;
  const appDesc = `${ev.name}（${ev.subtitle}）非官方排團工具，離線可用、免註冊、不蒐集個資：兩天${schedule.length}場演出的時間表與藝人介紹，排出自己的團序、撞團時抽籤。${unofficial}`;
  const appHead = head('', appTitle, appDesc, [webPage('', appTitle, appDesc, { about: { '@id': festId } }), festival(true), webAppJsonLd({ name: `${ev.name} 排團工具`, url: base, lang: ev.lang }), faqJsonLd()]);
  const appMd = [
    `# ${ev.name} 時間表（非官方排團工具）`, '',
    `${ev.subtitle}。${unofficial}`, '',
    `- 排團工具：${base}`, `- 官方網站：${official}`, ...(ev.urls.tickets ? [`- 售票：${ev.urls.tickets}`] : []), `- 用 Claude 做你自己的：${base}claude/`, '',
    ...ev.days.flatMap((d, i) => [
      `## ${dayLabel(d)}`, '',
      ...ev.stages.filter((st) => schedule.some((s) => s.day === i + 1 && s.stage === st.id)).flatMap((st) => [
        `### ${st.name}`, '',
        ...schedule.filter((s) => s.day === i + 1 && s.stage === st.id).sort((a, b) => a.start.localeCompare(b.start)).map((s) => {
          const who = s.note ? `${mdEsc(s.note)}（${mdEsc(s.name)}）` : mdEsc(s.name);
          const a = artists[people(s)[0]];
          return `- ${s.start}–${s.end} ${hasPage(a) ? `[${who}](${base}artists/${a.slug}/)` : who}`;
        }), '',
      ]),
    ]),
  ].join('\n');
  fs.writeFileSync(path.join(site, 'index.md'), appMd);
  pages.push({ path: '' });

  /* ---------- shared shell for the other pages ---------- */
  const themeBoot = `<script>try{var t=localStorage.getItem(${JSON.stringify(`fp:${ev.slug}:theme`)});if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>`;
  const shell = ({ p, title, description, graph, body, up }) => `<!doctype html>
<html lang="${esc(ev.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${esc(ev.icons?.themeColor || ev.theme.dark.bg)}">
${head(p, title, description, graph)}
${ev.icons?.png?.['180'] ? `<link rel="apple-touch-icon" href="${up}icon-180.png">` : ''}
${ev.icons?.png?.['192'] ? `<link rel="icon" href="${up}icon-192.png" sizes="192x192" type="image/png">` : ''}
<link rel="stylesheet" href="${up}page.css">
${themeBoot}
</head>
<body>
<header class="pg-top"><a class="pg-brand" href="${up}">${esc(ev.wordmark?.text || ev.shortName)}<small>${esc(ev.wordmark?.sub || '')}</small></a><span class="pg-sub">非官方排團工具</span></header>
<main class="pg">
${body}
</main>
<footer class="pg-foot"><p>${esc(unofficial)}</p><p><a href="${up}">打開排團工具</a>・<a href="${up}claude/">用 Claude 做你自己的</a>・<a href="${PRIVACY_PATH}">隱私說明</a>・<a href="${esc(official)}">官方網站</a></p></footer>
</body>
</html>
`;
  fs.writeFileSync(path.join(site, 'page.css'), pageCSS);

  /* ---------- one page per artist with an intro or links ---------- */
  for (const [name, a] of Object.entries(artists)) {
    if (!hasPage(a)) continue;
    const p = `artists/${a.slug}/`;
    const en = enOf(name);
    const shows = showsOf(name);
    const first = shows[0];
    const where = first ? `${when(first)} ${stage(first.stage).name}` : '';
    const lede = (a.bio || '').split('\n')[0];
    const title = `${name}｜${ev.name} 演出時間與介紹（非官方排團工具）`;
    const description = `${name}${en ? `（${en}）` : ''}在${ev.name}的演出${first ? `：${where}` : ''}。${lede.slice(0, 90)}${lede.length > 90 ? '…' : ''}`.trim();
    const picks = Object.entries(a.picks || {}).filter(([k]) => a.embeds?.[k]);
    const showRows = shows.map((s) => `<li><span class="pg-stage" style="--c: var(--stage-${esc(s.stage)})">${esc(stage(s.stage).name)}</span><span class="pg-when">${esc(when(s))}</span>${s.name !== name ? `<span class="pg-bill">${esc(s.note ? `${s.note}（${s.name}）` : s.name)}</span>` : ''}<a class="pg-btn" href="../../#show-${esc(s.id)}">在時間表上看</a></li>`).join('\n');
    const srcs = (list) => list.map((u) => `<a href="${esc(u)}">${esc(host(u))}</a>`).join('、');
    const body = [
      `<p class="pg-kicker">${esc(ev.name)} 演出藝人</p>`,
      `<h1>${esc(name)}</h1>`,
      en ? `<p class="pg-en" lang="en">${esc(en)}</p>` : '',
      shows.length ? `<section><h2>演出時間</h2><ul class="pg-shows">\n${showRows}\n</ul></section>` : '',
      `<section><h2>介紹</h2>${a.bio ? `${a.bio.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}${a.sources?.length ? `<p class="pg-src">資料來源：${srcs(a.sources)}</p>` : ''}` : '<p class="pg-none">目前沒有找到可靠的介紹資料。</p>'}</section>`,
      picks.length ? `<section><h2>推薦曲目</h2><ul class="pg-picks">\n${picks.map(([k, pk]) => `<li><p class="pg-song"><a href="${esc(pickURL(k, a.embeds[k]))}">${esc(pk.title)}</a><span class="pg-plat">${PICK[k]}</span></p><p>${esc(pk.why)}</p>${pk.sources?.length ? `<p class="pg-src">來源：${srcs(pk.sources)}</p>` : ''}</li>`).join('\n')}\n</ul></section>` : '',
      Object.keys(a.links || {}).length ? `<section><h2>串流平台</h2><p class="pg-links">${Object.entries(a.links).map(([k, u]) => `<a href="${esc(u)}">${PLAT[k] || esc(k)}</a>`).join('')}</p></section>` : '',
    ].filter(Boolean).join('\n');
    const who = { '@type': first?.note ? 'Person' : 'MusicGroup', '@id': `${base}${p}#artist`, name, ...(en ? { alternateName: en } : {}), url: base + p, ...(a.bio ? { description: a.bio.replace(/\n/g, ' ') } : {}), ...(Object.keys(a.links || {}).length ? { sameAs: Object.values(a.links) } : {}) };
    const graph = [webPage(p, title, description, { about: { '@id': who['@id'] } }), who, ...shows.map((s) => ({ ...showLd(s), superEvent: festival(false) }))];
    fs.mkdirSync(path.join(site, p), { recursive: true });
    fs.writeFileSync(path.join(site, p, 'index.html'), shell({ p, title, description, graph, body, up: '../../' }));
    const mdPage = [
      `# ${name}${en ? `（${en}）` : ''}`, '',
      `${ev.name} 演出藝人。${unofficial}`, '',
      ...(shows.length ? ['## 演出時間', '', ...shows.map((s) => `- ${when(s)} ${stage(s.stage).name}${s.name !== name ? `（${s.note ? `${s.note}，` : ''}${s.name}）` : ''}`), ''] : []),
      '## 介紹', '', a.bio || '目前沒有找到可靠的介紹資料。', '',
      ...(a.sources?.length ? [`資料來源：${a.sources.join(' ')}`, ''] : []),
      ...(picks.length ? ['## 推薦曲目', '', ...picks.flatMap(([k, pk]) => [`- ${PICK[k]}：[${mdEsc(pk.title)}](${pickURL(k, a.embeds[k])})——${pk.why}（來源：${(pk.sources || []).join(' ')}）`]), ''] : []),
      ...(Object.keys(a.links || {}).length ? ['## 串流平台', '', ...Object.entries(a.links).map(([k, u]) => `- ${PLAT[k] || k}：${u}`), ''] : []),
      `排團工具：${base}`,
    ].join('\n');
    fs.writeFileSync(path.join(site, p, 'index.md'), mdPage);
    pages.push({ path: p });
  }

  /* ---------- make your own with Claude ---------- */
  {
    const p = 'claude/';
    const prompt = claudePrompt(ev);
    const promptEn = claudePromptEn(ev);
    const title = `用 Claude 做你自己的排團工具｜${ev.name}（非官方）`;
    const description = `${ev.name}排團工具的做法公開：一段可以直接貼給 Claude 的提示、可以發成 artifact 的單一 HTML、時間表與藝人資料的 JSON，以及 GitHub 上的原始碼與 CLAUDE.md。Make your own festival planner with Claude.`;
    const en = (html) => `<p class="pg-en-text" lang="en">${html}</p>`;
    const files = [
      [rawArtifact, 'artifact 單檔（index.html）', '整個工具在一個 HTML 裡，Claude 可以直接發成 artifact。', 'The whole planner in one HTML file; Claude can publish it as an artifact.'],
      [`${base}data/schedule.json`, `${base}data/schedule.json`, '時間表：一筆一場演出（id、day、stage、start、end、name、en、note）。', 'Timetable: one entry per show (id, day, stage, start, end, name, en, note).'],
      [`${base}data/artists.json`, `${base}data/artists.json`, '藝人：以名稱為鍵，簡介、來源、平台連結與試聽 ID。', 'Artists, keyed by name: intro, sources, platform links and player IDs.'],
      [claudeMd, '這個活動的 CLAUDE.md', '資料怎麼轉、簡介和連結怎麼查證，照著做資料品質會一樣。', 'How the data was converted and checked, so yours can match.'],
      [repo, `GitHub：${repo.replace('https://', '')}`, '想做成網站：fork 之後複製一個活動資料夾，改資料再部署。', 'For a website: fork, copy an event folder, change the data, deploy.'],
    ];
    const features = [
      ['舞台 × 時間的時間表，點一下加入「我的團序」。', 'A stage-by-time timetable; tap a show to add it to your schedule.'],
      ['撞團時分組，選一團去、其他留作備選；也可以抽籤決定。', 'Clashing shows are grouped: pick one and keep the rest as back-ups, or let a draw decide.'],
      ['長按看藝人介紹與資料來源、試聽與平台連結；中英文名稱都搜得到。', 'Long-press for the artist intro, sources, players and links; search works in Chinese and English.'],
      ['活動當天標出現在時間和下一團。', 'On festival days it marks the current time and what is next.'],
    ];
    const body = `<p class="pg-kicker">${esc(ev.name)} 排團工具 <span lang="en">· Festival planner</span></p>
<h1>用 Claude 做你自己的排團工具</h1>
<p class="pg-en-h1" lang="en">Make your own festival planner with Claude</p>
<p>這個排團工具的程式和資料都公開。想幫別的音樂祭做一份，最快的方法是把下面這段提示貼給 Claude，再附上那個音樂祭的官方時間表圖片。</p>
${en('This planner&#39;s code and data are open. The quickest way to make one for another festival: paste the prompt below into Claude and attach that festival&#39;s official timetable image.')}
<section><h2>貼給 Claude 的提示 <span lang="en">· Prompt</span></h2>
<pre id="prompt" class="pg-prompt">${esc(prompt)}</pre>
<pre id="promptEn" class="pg-prompt" lang="en">${esc(promptEn)}</pre>
<p class="pg-note">「（活動名稱）」換成你的音樂祭。Claude 讀不到網址時，把單檔下載下來附上也可以。</p>
${en('Replace “(festival name)” with your festival. If Claude cannot open the links, download the single file and attach it.')}</section>
<section><h2>會用到的檔案 <span lang="en">· Files</span></h2><ul class="pg-files">
${files.map(([u, label, zh, e]) => `<li><a href="${esc(u)}">${esc(label)}</a><span>${esc(zh)}</span><span lang="en">${esc(e)}</span></li>`).join('\n')}
</ul></section>
<section><h2>做出來會有什麼 <span lang="en">· What you get</span></h2><ul class="pg-feats">
${features.map(([zh, e]) => `<li><span>${esc(zh)}</span><span lang="en">${esc(e)}</span></li>`).join('\n')}
</ul></section>
<script>
for (const [id, label, done] of [['prompt', '複製', '已複製'], ['promptEn', 'Copy', 'Copied']]) {
  const pre = document.getElementById(id);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pg-copy'; b.textContent = label;
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.textContent); b.textContent = done; }
    catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  });
  pre.after(b);
}
</script>`;
    const graph = [webPage(p, title, description, { about: { '@type': 'SoftwareSourceCode', name: 'festival-planner', codeRepository: repo, programmingLanguage: 'JavaScript' } })];
    fs.mkdirSync(path.join(site, p), { recursive: true });
    fs.writeFileSync(path.join(site, p, 'index.html'), shell({ p, title, description, graph, body, up: '../' }));
    fs.writeFileSync(path.join(site, p, 'index.md'), [
      '# 用 Claude 做你自己的排團工具 · Make your own festival planner with Claude', '',
      `${ev.name}排團工具（非官方）的程式和資料都公開。把下面這段提示貼給 Claude，附上你要做的音樂祭的官方時間表圖片。`, '',
      'This unofficial planner\'s code and data are open. Paste the prompt below into Claude with the official timetable image of the festival you want.', '',
      '## 提示 · Prompt', '',
      '```', prompt, '```', '',
      '```', promptEn, '```', '',
      '## 會用到的檔案 · Files', '',
      ...files.map(([u, label, zh, e]) => `- ${label}：${u} —— ${zh} / ${e}`), '',
      '## 做出來會有什麼 · What you get', '',
      ...features.map(([zh, e]) => `- ${zh} / ${e}`), '',
      unofficial,
    ].join('\n'));
    pages.push({ path: p });
  }

  /* ---------- public data, sitemap, header rules ---------- */
  fs.mkdirSync(path.join(site, 'data'), { recursive: true });
  fs.writeFileSync(path.join(site, 'data', 'schedule.json'), JSON.stringify(schedule, null, 1) + '\n');
  const pub = Object.fromEntries(Object.entries(artists).map(([n, { picks, ...a }]) => [n, a]));
  fs.writeFileSync(path.join(site, 'data', 'artists.json'), JSON.stringify(pub, null, 1) + '\n');
  fs.writeFileSync(path.join(site, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((pg) => `  <url><loc>${base + pg.path}</loc><lastmod>${ev.dataDate}</lastmod></url>`).join('\n')}
</urlset>
`);
  return { appHead, appTitle, appDesc, staticBlock, pages: pages.map((pg) => pg.path), dataLine: unofficial };
}
