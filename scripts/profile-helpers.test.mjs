import test from 'node:test';
import assert from 'node:assert/strict';
import { importedMonth, importedYear, monthYearValue, parseMonthYear } from '../client/src/lib/monthYear.mjs';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, clampDirectoryLimit, pageSizeFrom, serverPageCap } from '../client/src/lib/directory.mjs';
import { focusSuggestions, readableSkills } from '../client/src/lib/reflection.mjs';
import { ApiError } from '../client/src/lib/apiError.mjs';

test('a year without a month stays a year without a month', () => {
  // What a CV import returns for "2020": the year as text and no month.
  assert.equal(monthYearValue('2020', ''), '2020-');
  assert.deepEqual(parseMonthYear('2020-'), { year: 2020, month: null });
  // Saving and loading again never turns it into January.
  const saved = parseMonthYear(monthYearValue('2020', ''));
  assert.equal(monthYearValue(saved.year, saved.month), '2020-');
  assert.deepEqual(parseMonthYear(monthYearValue(2020, null)), { year: 2020, month: null });
});

test('a real month is kept, and empty dates stay empty', () => {
  assert.equal(monthYearValue('2020', '4'), '2020-04');
  assert.equal(monthYearValue(2020, 4), '2020-04');
  assert.deepEqual(parseMonthYear('2020-04'), { year: 2020, month: 4 });
  assert.deepEqual(parseMonthYear('2021-12'), { year: 2021, month: 12 });
  assert.equal(monthYearValue('', ''), '');
  assert.equal(monthYearValue(null, 5), '');
  assert.equal(monthYearValue('present', ''), '');
  assert.deepEqual(parseMonthYear(''), { year: null, month: null });
  // The picker's old "no month" encoding still reads as no month.
  assert.deepEqual(parseMonthYear('2020-00'), { year: 2020, month: null });
  assert.equal(importedYear('Sept 2019'), 2019);
  assert.equal(importedYear('20'), null);
  assert.equal(importedMonth('13'), null);
  assert.equal(importedMonth('09'), 9);
});

test('the directory limit is clamped to the sizes the server serves', () => {
  assert.deepEqual(PAGE_SIZES, [25, 50, 100]);
  for (const size of PAGE_SIZES) {
    assert.equal(clampDirectoryLimit(String(size)), size);
    assert.equal(pageSizeFrom(String(size)), size);
  }
  assert.equal(clampDirectoryLimit('500'), 100);
  assert.equal(clampDirectoryLimit('0'), DEFAULT_PAGE_SIZE);
  assert.equal(clampDirectoryLimit('-3'), DEFAULT_PAGE_SIZE);
  assert.equal(clampDirectoryLimit(null), DEFAULT_PAGE_SIZE);
  assert.equal(clampDirectoryLimit('abc'), DEFAULT_PAGE_SIZE);
  // Only the offered sizes can come from the URL.
  assert.equal(pageSizeFrom('12'), DEFAULT_PAGE_SIZE);
  assert.equal(pageSizeFrom('1000'), DEFAULT_PAGE_SIZE);
  assert.equal(pageSizeFrom(null), DEFAULT_PAGE_SIZE);
});

test('a server that serves less than asked is noticed, and only then', () => {
  assert.equal(serverPageCap(100, null), null);
  assert.equal(serverPageCap(100, { limit: 100 }), null);
  assert.equal(serverPageCap(25, { limit: 25 }), null);
  assert.equal(serverPageCap(100, { limit: 50 }), 50);
  // A database without the 100-row migration reports no limit and serves 50.
  assert.equal(serverPageCap(100, { total: 230 }), 50);
  assert.equal(serverPageCap(50, { total: 230 }), null);
  assert.equal(serverPageCap(25, { total: 230 }), null);
});

test('older check-ins keep every suggestion but lead with two', () => {
  const legacy = ['leadership', 'strategic_planning', 'team_cohesion', 'conflict_resolution', 'vision_articulation'];
  const focused = focusSuggestions(legacy);
  assert.deepEqual(focused.shown, ['leadership', 'strategic planning']);
  assert.deepEqual(focused.more, ['team cohesion', 'conflict resolution', 'vision articulation']);
  assert.equal(focused.shown.length + focused.more.length, legacy.length, 'nothing is dropped');
  // New entries already carry two at most and are shown whole.
  assert.deepEqual(focusSuggestions(['public speaking']), { shown: ['public speaking'], more: [] });
  assert.deepEqual(focusSuggestions(['a', 'b']), { shown: ['a', 'b'], more: [] });
  assert.deepEqual(focusSuggestions(null), { shown: [], more: [] });
  assert.deepEqual(readableSkills(['team_work', 'team work', '  ', null]), ['team work']);
});

test('every data-layer failure carries a status and a code', () => {
  // Callers branch on these two fields; the browser fixture throws this same class.
  const refused = new ApiError('mentor_at_capacity', 400);
  assert.equal(refused.response.status, 400);
  assert.equal(refused.response.data.error, 'mentor_at_capacity');
  assert.ok(refused instanceof Error);
  // With no status the outcome is uncertain, never a refusal.
  const dropped = new ApiError('TypeError: Failed to fetch');
  assert.equal(dropped.response.status, 500);
  assert.equal(dropped.response.data.error, 'TypeError: Failed to fetch');
});
