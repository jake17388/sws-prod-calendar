import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tvWindowDays, tvColumnTemplate, isWeekend, formatISO, TV_DAY_TRACK, TV_WEEKEND_TRACK } from '../js/dates.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const weekSource = fs.readFileSync(path.join(projectRoot, 'js/views/week.js'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'js/app.js'), 'utf8');
const tvStyles = fs.readFileSync(path.join(projectRoot, 'styles/tv.css'), 'utf8');

const isoWindow = (y, m, d) => tvWindowDays(new Date(y, m - 1, d)).map(formatISO);

test('the TV strip opens on the previous work day so today sits second from the left', () => {
  // Friday 2026-08-28: Thu, [today] Fri, thin Sat + Sun, then Mon/Tue/Wed.
  assert.deepEqual(isoWindow(2026, 8, 28), [
    '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
  ]);
});

test('the TV strip spans today plus the next three work days', () => {
  // Monday: the previous work day is Friday, so the weekend rides along thin.
  assert.deepEqual(isoWindow(2026, 8, 31), [
    '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
  ]);
  // Tuesday: an entirely mid-week window needs no weekend columns at all.
  assert.deepEqual(isoWindow(2026, 9, 1), [
    '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
  ]);
  // Wednesday: the look-ahead crosses the weekend to reach Monday.
  assert.deepEqual(isoWindow(2026, 9, 2), [
    '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07',
  ]);
});

test('a weekend TV window still leads with the last work day', () => {
  // Saturday 2026-08-29 and Sunday 2026-08-30 both look back to Friday.
  assert.deepEqual(isoWindow(2026, 8, 29).at(0), '2026-08-28');
  assert.deepEqual(isoWindow(2026, 8, 30).at(-1), '2026-09-02');
});

test('isWeekend marks only Saturday and Sunday', () => {
  assert.equal(isWeekend(new Date(2026, 7, 29)), true);
  assert.equal(isWeekend(new Date(2026, 7, 30)), true);
  assert.equal(isWeekend(new Date(2026, 7, 28)), false);
  assert.equal(isWeekend(new Date(2026, 7, 31)), false);
});

test('collapsed weekend days get a sliver track and work days share the rest', () => {
  assert.equal(
    tvColumnTemplate([false, false, true, true, false, false, false]),
    [TV_DAY_TRACK, TV_DAY_TRACK, TV_WEEKEND_TRACK, TV_WEEKEND_TRACK, TV_DAY_TRACK, TV_DAY_TRACK, TV_DAY_TRACK].join(' '),
  );
  assert.equal(tvColumnTemplate([false, false]), `${TV_DAY_TRACK} ${TV_DAY_TRACK}`);
});

test('week view renders the rolling TV window instead of the calendar week', () => {
  assert.match(weekSource, /import \{ isTvDisplay \} from '\.\.\/auth\.js'/);
  assert.match(weekSource, /isTvDisplay\(\)\s*\?\s*tvWindowDays\(refDate\)\s*:\s*weekDays\(refDate\)/);
  // A weekend day only collapses when nothing is actually due on it.
  assert.match(weekSource, /isWeekend\(day\)\s*&&\s*!dayJobs\.length/);
  assert.match(weekSource, /setProperty\('--week-cols', tvColumnTemplate\(/);
  // The range label must survive windows shorter than seven days.
  assert.doesNotMatch(weekSource, /days\[6\]/);
});

test('the TV display reloads itself once an hour', () => {
  assert.match(appSource, /TV_RELOAD_INTERVAL_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(appSource, /setInterval\(\(\) => \{\s*if \(isTvDisplay\(\)\) window\.location\.reload\(\);\s*\}, TV_RELOAD_INTERVAL_MS\)/);
});

test('collapsed TV columns shrink their header instead of hiding the date', () => {
  assert.match(tvStyles, /body\.tv-mode\s+\.week-day-col\.is-collapsed/);
  assert.match(tvStyles, /body\.tv-mode\s+\.week-day-col\.is-collapsed\s+\.week-day-header[\s\S]{0,200}font-size/);
});
