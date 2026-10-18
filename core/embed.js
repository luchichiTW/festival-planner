/* In-card listening (event.json features.embeds): Spotify, Apple Music, YouTube, Spotify podcasts and StreetVoice,
   from the IDs in artists.json "embeds". Third-party players load only when someone opens an artist card, never on
   page load, and not at all offline. Website only — the single-file artifact shows the bio without players. */
(() => {
  const PLATFORMS = [
    ['spotify', 'Spotify'],
    ['spotifyPodcast', 'Podcast'],
    ['appleMusic', 'Apple Music'],
    ['streetvoice', 'StreetVoice'],
    ['youtube', 'YouTube'],
  ];
  const enc = encodeURIComponent;
  function src(platform, id, dark) {
    switch (platform) {
      case 'spotify': return `https://open.spotify.com/embed/artist/${enc(id)}?utm_source=generator&theme=${dark ? 0 : 1}`;
      case 'spotifyPodcast': return `https://open.spotify.com/embed/show/${enc(id)}?utm_source=generator&theme=${dark ? 0 : 1}`;
      case 'appleMusic': return `https://embed.music.apple.com/tw/album/${enc(id)}?app=music&theme=${dark ? 'dark' : 'light'}`;
      case 'streetvoice': return `https://streetvoice.com/music/embed/?id=${enc(id)}`;
      case 'youtube': return `https://www.youtube-nocookie.com/embed/${enc(id)}`;
      default: return '';
    }
  }

  // Fills box with a platform switcher (when there is more than one) and the first player. Returns false when the
  // entry has nothing playable, so the caller can fall back to plain links.
  function render(box, embeds, { dark = true, label = (s) => s } = {}) {
    const avail = PLATFORMS.filter(([k]) => embeds && embeds[k]);
    if (!avail.length || navigator.onLine === false) { box.hidden = true; box.innerHTML = ''; return false; }
    box.hidden = false;
    box.innerHTML = (avail.length > 1
      ? `<div class="emb-seg" role="tablist" aria-label="${label('試聽')}">${avail.map(([k, name], i) => `<button type="button" role="tab" data-emb="${k}" aria-selected="${i === 0}">${name}</button>`).join('')}</div>`
      : '') + '<div class="emb-frame"></div>';
    const frame = box.querySelector('.emb-frame');
    const show = (k) => {
      const name = (avail.find(([x]) => x === k) || [k, k])[1];
      frame.className = `emb-frame emb-${k}`;
      frame.innerHTML = `<iframe src="${src(k, embeds[k], dark)}" title="${name}" loading="lazy" allow="autoplay *; encrypted-media *; clipboard-write; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      box.querySelectorAll('[data-emb]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.emb === k)));
    };
    box.onclick = (e) => { const b = e.target.closest('[data-emb]'); if (b) show(b.dataset.emb); };
    show(avail[0][0]);
    return true;
  }

  window.FP_EMBED = { render, platforms: PLATFORMS.map(([k]) => k) };
})();
