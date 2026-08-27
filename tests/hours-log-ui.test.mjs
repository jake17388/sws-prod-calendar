import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Costing Viewers and admins receive a dedicated Hours Log view backed by the protected API', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const auth = read('js/auth.js');
  const api = read('js/api.js');

  assert.match(html, /id="view-btn-hours-log"[^>]*>Hours Log</);
  assert.match(app, /hoursLog:\s*\{\s*render:\s*renderHoursLog/);
  assert.match(app, /view-btn-hours-log/);
  assert.match(app, /canViewHoursLog\(\)/);
  assert.match(auth, /export const canViewHoursLog/);
  assert.match(auth, /export const canEditHoursLog/);
  assert.match(auth, /canViewHoursLog[\s\S]*Admin[\s\S]*Manager[\s\S]*Viewer[\s\S]*Costing Viewer/);
  assert.match(auth, /canEditHoursLog[\s\S]*Admin[\s\S]*Costing Viewer/);
  assert.match(api, /fetchJobTimeLog\s*=\s*\(\)\s*=>\s*scriptGet\(['"]getJobTimeLog['"]\)/);
  assert.match(api, /updateJobTimeEntry/);
  assert.match(api, /deleteJobTimeEntry/);
});

test('the Hours Log defaults to rows that unlock editing with a pencil', () => {
  const view = read('js/views/hoursLog.js');
  const css = read('styles/job-selector.css');

  assert.match(view, /Hours Log/);
  assert.match(view, /Employee/);
  assert.match(view, /Job/);
  assert.match(view, /Duration/);
  assert.match(view, /Last edited/);
  assert.match(view, /datetime-local/);
  assert.match(view, /updateJobTimeEntry/);
  assert.match(view, /deleteJobTimeEntry/);
  assert.match(view, /aria-label="Edit hour log"/);
  assert.match(view, /Delete this hour log\?/);
  assert.match(view, />Confirm</);
  assert.match(view, />Cancel</);
  assert.doesNotMatch(view, /class="hours-log-input hours-log-employee"/);
  assert.doesNotMatch(view, /class="hours-log-input hours-log-job-name"/);
  assert.match(view, /editedAt/);
  assert.match(view, /editedBy/);
  assert.match(view, /fetchJobTimeLog/);
  assert.match(css, /hours-log-table/);
  assert.match(css, /overflow-x:\s*auto/);
});
