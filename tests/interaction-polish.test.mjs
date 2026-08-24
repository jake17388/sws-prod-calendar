import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createKeyedDebouncer } from '../js/keyedDebouncer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('rapid changes for one control commit only the final action', () => {
  const timers = [];
  const cleared = new Set();
  const debouncer = createKeyedDebouncer(220, {
    setTimer: callback => { timers.push(callback); return timers.length - 1; },
    clearTimer: id => cleared.add(id),
  });
  const committed = [];

  debouncer.schedule('job-1', () => committed.push('first'));
  debouncer.schedule('job-1', () => committed.push('second'));
  debouncer.schedule('job-1', () => committed.push('final'));

  timers.forEach((callback, id) => { if (!cleared.has(id)) callback(); });
  assert.deepEqual(committed, ['final']);
  assert.equal(debouncer.pending('job-1'), false);
});

test('separate controls debounce independently', () => {
  const timers = [];
  const debouncer = createKeyedDebouncer(220, {
    setTimer: callback => { timers.push(callback); return timers.length - 1; },
    clearTimer: () => {},
  });
  const committed = [];

  debouncer.schedule('job-1', () => committed.push('job'));
  debouncer.schedule('task-1', () => committed.push('task'));
  timers.forEach(callback => callback());

  assert.deepEqual(committed, ['job', 'task']);
});

test('interactive controls expose tactile, saving, skeleton, and reduced-motion states', () => {
  const layout = read('styles/layout.css');
  const cards = read('styles/job-card.css');
  const departments = read('styles/dept-assign.css');
  const app = read('js/app.js');
  const jobCard = read('js/components/jobCard.js');
  const assignment = read('js/components/departmentAssign.js');

  assert.match(layout, /button:not\(:disabled\):active/);
  assert.match(layout, /prefers-reduced-motion:\s*reduce/);
  assert.match(app, /skeleton-job-card/);
  assert.match(jobCard, /completionPending/);
  assert.match(cards, /job-card-checkbox\.saving/);
  assert.match(assignment, /taskToggleDebouncer/);
  assert.match(departments, /checklist-check\.saving/);
});

test('open job editing suppresses global saving noise and background replacement refreshes', () => {
  const app = read('js/app.js');
  assert.match(app, /isJobDetailOpen\(\)/);
  assert.match(app, /showStatus\s*=\s*pending[\s\S]{0,160}!isJobDetailOpen\(\)/);
  assert.match(app, /if\s*\(isJobDetailOpen\(\)[^)]*\)[^{]*return/);
});
