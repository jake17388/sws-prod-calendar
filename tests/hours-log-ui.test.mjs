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
  assert.match(api, /fetchJobTimeLog\s*=\s*\(from, to\)\s*=>\s*scriptGet\(['"]getJobTimeLog['"]/);
  assert.match(api, /exportJobTimeLog/);
  assert.match(api, /updateJobTimeEntry/);
  assert.match(api, /deleteJobTimeEntry/);
});

test('the Hours Log defaults to rows that unlock editing with a pencil', () => {
  const view = read('js/views/hoursLog.js');
  const css = read('styles/job-selector.css');

  assert.match(view, /Hours Log/);
  assert.match(view, /Export to Excel/);
  assert.match(view, /exportJobTimeLog/);
  assert.match(view, /Employee/);
  assert.match(view, /Job/);
  assert.match(view, /Duration/);
  assert.match(view, /Last edited/);
  assert.match(view, /datetime-local/);
  assert.match(view, /updateJobTimeEntry/);
  assert.match(view, /deleteJobTimeEntry/);
  assert.match(view, /aria-label="Edit hour log"/);
  assert.match(view, /Delete this hour log\?/);
  assert.match(view, /aria-describedby="hours-log-delete-description"/);
  assert.match(view, /inert aria-hidden="true"/);
  assert.match(view, /hours-log-dialog[\s\S]*keydown/);
  assert.match(view, /Confirm delete/);
  assert.match(view, />Cancel</);
  assert.doesNotMatch(view, /class="hours-log-input hours-log-employee"/);
  assert.doesNotMatch(view, /class="hours-log-input hours-log-job-name"/);
  assert.match(view, /editedAt/);
  assert.match(view, /editedBy/);
  assert.match(view, /fetchJobTimeLog/);
  assert.match(view, /isCostingEntry/);
  assert.match(view, /Not job specific/);
  assert.match(view, /Costing button/);
  assert.match(view, /data-label="Employee"/);
  assert.match(view, /data-label="Actions"/);
  assert.match(css, /hours-log-table/);
  assert.match(css, /\.hours-log-dialog\s*\{[^}]*background:\s*var\(--surface-overlay\)/);
  assert.match(css, /\.hours-log-dialog-actions \.hours-log-delete-confirm\s*\{[^}]*background:\s*var\(--status-critical-solid\)/);
  assert.match(css, /overflow-x:\s*visible/);
  assert.match(css, /table-layout:\s*fixed/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.hours-log-table tr[\s\S]*grid-template-columns/);
  assert.doesNotMatch(css, /\.hours-log-table\s*\{[^}]*min-width/);
});

test('the Hours Log picks its range with the Job Map day-nav and calendar popover', () => {
  const view = read('js/views/hoursLog.js');
  const css = read('styles/job-selector.css');

  // Day bar: prev / label / next, with the label opening the picker.
  assert.match(view, /hours-log-day-nav-prev/);
  assert.match(view, /hours-log-day-nav-next/);
  assert.match(view, /hours-log-day-nav-label/);
  assert.match(view, /Previous day/);
  assert.match(view, /Next day/);
  assert.match(view, /Pick a date or range/);
  // A single day on today reads as "Today" rather than a formatted date.
  assert.match(view, /'Today'/);

  // Calendar popover internals ported from the Job Map.
  assert.match(view, /hours-log-calendar-backdrop/);
  assert.match(view, /hours-log-calendar-grid/);
  assert.match(view, /hours-log-calendar-weekdays/);
  assert.match(view, /Jump to today/);
  assert.match(view, /Previous month/);
  assert.match(view, /Next month/);
  assert.match(view, /Tap a day to start/);

  // Range state: first tap starts, second tap closes the range; same day twice is one day.
  assert.match(view, /range-start/);
  assert.match(view, /range-end/);
  assert.match(view, /in-range/);
  assert.match(view, /calPickStart/);

  // The picker applies on selection, so the separate apply button is gone.
  assert.doesNotMatch(view, /Apply dates/);
  assert.doesNotMatch(view, /type="date"/);

  // Popover is a real dialog, like the delete confirmation beside it.
  assert.match(view, /hours-log-calendar[\s\S]*role="dialog"/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /hours-log-calendar[\s\S]*keydown/);

  // Styling uses app tokens rather than the Job Map's hardcoded palette.
  assert.match(css, /\.hours-log-calendar-day\.range-start[\s\S]*var\(--accent-solid\)/);
  assert.match(css, /\.hours-log-calendar-day\.in-range/);
  assert.match(css, /\.hours-log-calendar-grid\s*\{[^}]*repeat\(7, 1fr\)/);
  assert.doesNotMatch(css, /\.hours-log-calendar[^}]*#fafafa/);
});
