import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const monthSource = fs.readFileSync(path.join(projectRoot, 'js/views/month.js'), 'utf8');
const calendarStyles = fs.readFileSync(path.join(projectRoot, 'styles/calendar.css'), 'utf8');

test('month cells render every job without an expand or collapse control', () => {
  assert.match(
    monthSource,
    /dayJobs\.forEach\(job => jobsWrap\.appendChild\(renderJobChip\(job\)\)\);/,
  );
  assert.doesNotMatch(monthSource, /MAX_VISIBLE_PER_CELL|expandedDays|month-cell-more|See less/);
});

test('month rows grow to fit their complete job lists', () => {
  assert.match(calendarStyles, /grid-auto-rows:\s*minmax\(128px, auto\)/);
  assert.doesNotMatch(calendarStyles, /\.month-cell-more/);
});
