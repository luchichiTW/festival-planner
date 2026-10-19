// 浪人祭 in English: only where the festival published English itself (the official English timetable, Threads
// 2026/10/17). Stage names, every act's name and the 浪人塾 talk titles come from it; the venue has no official
// English, so the subtitle stays Chinese (no subtitleEn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvent, validate } from '../scripts/validate.mjs';

const { event: ev, schedule, ...rest } = loadEvent('vagabond2026');
const CJK = /[㐀-鿿\u{20000}-\u{2ffff}ぁ-ゟ゠-ヿ]/u;

test('浪人祭 offers English, with the official English stage names', () => {
  assert.deepEqual(ev.languages, ['zh', 'en']);
  assert.equal(ev.nameEn, 'Vagabond Festival 2026');
  assert.equal(ev.subtitleEn, undefined, 'no official English for the venue');
  assert.deepEqual(Object.fromEntries(ev.stages.map((s) => [s.id, s.en])), {
    K: 'Kun Shen Stage', J: 'Jian Shih Stage', H: 'Jin Ho Ting Stage', X: 'Xiao Si Men Stage',
    F: 'Fong Shih Stage', R: 'Ronin Cram School', L: 'Red Bull LUKA',
  });
  assert.deepEqual(validate({ event: ev, schedule, ...rest }).errors, []);
});

test('every act written in Chinese or Japanese has its official English name', () => {
  const missing = schedule.filter((s) => CJK.test(s.name) && !s.en).map((s) => s.name);
  assert.deepEqual(missing, []);
  const en = (id) => schedule.find((s) => s.id === id).en;
  assert.equal(en('d1-xiaoweiba-talk'), 'Tiest ft. Yitsen');
  assert.equal(en('d1-freckles'), 'Freckles');
  assert.equal(en('d2-gordon'), 'GorDoN');
});

test('the 浪人塾 talks carry their official English titles', () => {
  const titles = Object.fromEntries(schedule.filter((s) => s.note).map((s) => [s.id, s.noteEn]));
  assert.deepEqual(titles, {
    'd1-xiaoweiba-talk': 'Is it difficult to perform at a festival?',
    'd1-gao-xiao-gao-talk': 'The Punk Siren’s Spiritual Yoga Class',
    'd2-whateveryousay-talk': 'Fund Your Concert Freedom',
    'd2-strongstrong-talk': 'Action! — Acting 101 with Strong Strong',
  });
});
