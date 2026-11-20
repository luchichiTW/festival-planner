// scripts/lineup.mjs: reading the festival's lineup page and each act's page (made-up markup in the same shape as the
// festival site's WordPress theme), and telling what changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineup, parseAct, diffLineup } from '../scripts/lineup.mjs';

const BASE = 'https://fest.example/artists/all/';
const tile = (href, title) => `<a href="${href}" id='av-masonry-1-item-1' data-av-masonry-item='1' class='av-masonry-entry isotope-item post-1 portfolio type-portfolio' title="${title}" itemscope="itemscope"><h3 class='av-masonry-entry-title entry-title'>${title}</h3></a>`;

test('the lineup page: every act in its order, names unescaped, links on other sites ignored', () => {
  const html = `<div class="av-masonry-container">${[
    tile('https://fest.example/portfolio-item/a/', 'Band A'),
    tile('https://fest.example/portfolio-item/b/', 'B &amp; C'),
    tile('https://elsewhere.example/x/', 'Ad'),
    tile('https://fest.example/portfolio-item/%e6%b4%aa/', '洪'),
  ].join('')}</div>`;
  assert.deepEqual(parseLineup(html, BASE), [
    { name: 'Band A', page: 'https://fest.example/portfolio-item/a/' },
    { name: 'B & C', page: 'https://fest.example/portfolio-item/b/' },
    { name: '洪', page: 'https://fest.example/portfolio-item/%e6%b4%aa/' },
  ]);
});

test('an act’s page: its name from the title, and only the labelled link buttons in the page body', () => {
  const html = `<title>Chris Hung - Fest</title>
    <a href="https://fest.example/">MENU</a>
    <div class='post-entry post-entry-type-page post-entry-1'>
      <a href='https://www.facebook.com/x/' class='avia-button'><span class='avia_iconbox_title'>FACEBOOK</span></a>
      <a href='https://www.instagram.com/x/'><span>INSTAGRAM</span></a>
      <a href='https://x.com/x'><span>X</span></a>
      <a href='http://band.example/'><span>OFFICIAL</span></a>
      <a href='https://shop.example/'><span>SHOP</span></a>
    </div>
    <div id='footer'><a href="https://www.instagram.com/fest/">INSTAGRAM</a></div>`;
  assert.deepEqual(parseAct(html), {
    title: 'Chris Hung',
    links: { facebook: 'https://www.facebook.com/x/', instagram: 'https://www.instagram.com/x/', x: 'https://x.com/x', official: 'http://band.example/' },
  });
});

test('what changed: added, gone, new links, a new order', () => {
  const a = { name: 'A', page: 'p/a', links: {} };
  const b = { name: 'B', page: 'p/b', links: {} };
  const c = { name: 'C', page: 'p/c', links: {} };
  assert.equal(diffLineup([a, b], [a, b]).same, true);
  assert.deepEqual(diffLineup([a, b], [a, b, c]).added, ['C']);
  assert.deepEqual(diffLineup([a, b], [a]).removed, ['B']);
  assert.deepEqual(diffLineup([a, b], [a, { ...b, links: { x: 'https://x.com/b' } }]).changed, ['B']);
  assert.equal(diffLineup([a, b], [b, a]).reordered, true);
});
