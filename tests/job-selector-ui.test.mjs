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

test('the Job Selector screen includes assigned jobs, Other lookup, active status, and Stop Work', () => {
  const view = read('js/views/jobSelector.js');
  const api = read('js/api.js');
  const css = read('styles/job-selector.css');

  assert.match(view, /What job are you beginning work on\?/);
  assert.match(view, /Other job number/);
  assert.match(view, /Stop Work/);
  assert.match(view, /Currently working on/);
  assert.match(api, /fetchJobTimeStatus/);
  assert.match(api, /lookupSquarecoilJob/);
  assert.match(api, /startJobTime/);
  assert.match(api, /stopJobTime/);
  assert.match(css, /min-height:\s*44px/);
});
