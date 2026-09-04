import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the Job Selector model returns only assigned jobs with open department tasks', async () => {
  const { selectableJobSelectorJobs } = await import('../js/jobSelectorModel.mjs');
  const jobs = [
    { jobNum: '260003', title: 'Later', completed: false, dueDate: '2026-08-27', departments: ['Paint'], departmentChecklists: { Paint: [{ done: false }] } },
    { jobNum: '260001', title: 'First', completed: false, dueDate: '2026-08-25', departments: ['Paint'], departmentChecklists: { Paint: [{ done: false }, { done: true }] } },
    { jobNum: '260002', title: 'Done', completed: false, dueDate: '2026-08-24', departments: ['Paint'], departmentChecklists: { Paint: [{ done: true }] } },
    { jobNum: '260004', title: 'Other Department', completed: false, dueDate: '2026-08-24', departments: ['Assembly'], departmentChecklists: { Assembly: [{ done: false }] } },
    { jobNum: '260005', title: 'Completed', completed: true, dueDate: '2026-08-23', departments: ['Paint'], departmentChecklists: { Paint: [{ done: false }] } },
  ];

  assert.deepEqual(
    selectableJobSelectorJobs(jobs, 'Paint').map(job => [job.jobNum, job.openTaskCount]),
    [['260001', 1], ['260003', 1]],
  );
});

test('production workers get Job Selector in the manager action location', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const auth = read('js/auth.js');

  assert.match(html, /id="view-btn-job-selector"[^>]*>Job Selector</);
  assert.match(app, /jobSelector:\s*\{\s*render:\s*renderJobSelector/);
  assert.match(app, /view-btn-job-selector/);
  assert.match(auth, /canUseJobSelector/);
});

test('production workers land on Schedule while Job Selector remains available', () => {
  const app = read('js/app.js');
  const view = read('js/views/jobSelector.js');
  const api = read('js/api.js');

  assert.match(app, /const DEFAULT_VIEW\s*=\s*['"]schedule['"]/);
  assert.match(view, /data-job-name=/);
  assert.match(view, /startJobTime\(jobNum,\s*source,\s*jobName,\s*costingButtonId\)/);
  assert.match(api, /startJobTime\s*=\s*\(jobNum,\s*source,\s*jobName,\s*costingButtonId/);
});

test('the Job Selector screen includes assigned jobs, separate Other activity input, active status, and Stop Work', () => {
  const view = read('js/views/jobSelector.js');
  const api = read('js/api.js');
  const css = read('styles/job-selector.css');

  assert.match(view, /What job are you beginning work on\?/);
  assert.match(view, /Other Job Numbers\/Activities/);
  assert.match(view, /job-selector-other-activity/);
  assert.match(view, /source: 'other_activity'/);
  assert.match(view, /Stop Work/);
  assert.match(view, /Currently working on/);
  assert.match(api, /fetchJobTimeStatus/);
  assert.match(api, /lookupSquarecoilJob/);
  assert.match(api, /startJobTime/);
  assert.match(api, /stopJobTime/);
  assert.match(css, /min-height:\s*44px/);
});

test('the Job Selector no longer renders configurable Costing Activities', () => {
  const view = read('js/views/jobSelector.js');
  const api = read('js/api.js');
  const css = read('styles/job-selector.css');

  assert.doesNotMatch(view, /Costing activities/);
  assert.doesNotMatch(view, /job-selector-costing-button/);
  assert.doesNotMatch(view, /fetchCostingButtons/);
  assert.match(view, /job-selector-note-edit/);
  assert.match(api, /saveJobTimeNote/);
  assert.match(css, /job-selector-other-activity-controls/);
});

test('active jobs use a two-line identity and stable action columns with an optimistic note preview', () => {
  const view = read('js/views/jobSelector.js');
  const css = read('styles/job-selector.css');

  assert.match(view, /job-selector-active-job-number/);
  assert.match(view, /job-selector-active-job-name/);
  assert.match(view, /job-selector-active-note-preview/);
  assert.match(view, /pending: true/);
  assert.doesNotMatch(view, /if \(actionBusy\) return;\n  const previousEntries = activeEntries;/);
  assert.match(css, /\.job-selector-active-entry[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto/);
  assert.match(css, /\.job-selector-active-note-preview/);
});

test('stopping an active job does not put the whole selector into a busy state', () => {
  const view = read('js/views/jobSelector.js');
  assert.doesNotMatch(view, /function endWork\(container, jobs, entryId\) \{\n  if \(actionBusy/);
  assert.match(view, /stopPending/);
  assert.match(view, /Stopping…/);
});

test('job starts and stops paint optimistically while backend saves stay out of the global header', () => {
  const view = read('js/views/jobSelector.js');
  const app = read('js/app.js');

  assert.match(view, /const previousEntry\s*=\s*activeEntry/);
  assert.match(view, /activeEntry\s*=\s*optimisticEntry/);
  assert.match(view, /activeEntry\s*=\s*previousEntry/);
  assert.match(app, /activeView\s*!==\s*['"]jobSelector['"]/);
});
