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

// Once the timetable is out, data/lineup.json stays: the planner turns each act marked 想看 into its sets.
export function plannerWithLineup(slug = 'wantexample') {
  const e = loadEvent('megaport2026');
  e.slug = slug;
  e.event = { ...e.event, slug, urls: { ...e.event.urls, site: `https://chiparashi.tw/${slug}/` } };
  const pick = (name) => e.schedule.find((s) => s.name === name);
  const tagged = e.schedule.find((s) => / \[JP\]$/.test(s.name));
  e.lineup = [
    { name: pick('滅火器').name, en: 'Fire EX.', page: 'https://megaportfest.com/portfolio-item/fire-ex/', links: {} },
    { name: tagged.name.replace(/ \[JP\]$/, ''), page: 'https://megaportfest.com/portfolio-item/tagged/', links: {} },
    { name: '寫法不一樣的團', page: 'https://megaportfest.com/portfolio-item/linked/', links: {} },
  ];
  const linked = e.schedule.find((s) => s !== pick('滅火器') && s !== tagged);
  e.schedule = e.schedule.map((s) => (s === linked ? { ...s, lineup: 'linked' } : s));
  return { e, ids: { fire: pick('滅火器').id, tagged: tagged.id, linked: linked.id } };
}
