// Test helpers shared by several test files (not a test file itself: npm test runs tests/*.test.mjs).
import { loadEvent } from '../scripts/validate.mjs';

// No event is waiting for its announcement right now: tests turn megaport2027 back into one, under any slug.
export function tbaEvent(slug = 'megaport2027') {
  const e = loadEvent('megaport2027');
  const { status, subtitle, subtitleEn, dataDate, sourceNote, sourceNoteEn, rules, languages, ...rest } = e.event;
  e.slug = slug;
  e.event = { ...rest, slug, status: 'tba', notice: '待官方資訊公布', noticeEn: 'Waiting for the official announcement.', ticketNote: '待官方資訊公布・每年更新', urls: { ...rest.urls, site: `https://chiparashi.tw/${slug}/` } };
  e.lineup = [];
  e.artists = {};
  return e;
}
