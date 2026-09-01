import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Admin, Manager, and Viewer accounts get an Other Production screen', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const auth = read('js/auth.js');

  assert.match(html, /id="view-btn-other-production"[^>]*>Other Production</);
  assert.match(app, /otherProduction:\s*\{\s*render:\s*renderOtherProduction/);
  assert.match(app, /view-btn-other-production/);
  assert.match(auth, /canViewOtherProduction[\s\S]*Admin[\s\S]*Manager[\s\S]*Viewer/);
});

test('Other Production stacks only open, unscheduled handoff jobs with normal job cards', () => {
  const view = read('js/views/otherProduction.js');

  assert.match(view, /isOtherProduction/);
  assert.match(view, /!job\.dueDate/);
  assert.match(view, /!job\.completed/);
  assert.match(view, /renderJobCard/);
});

test('Manager due-date access is scoped to Other Production jobs in the job detail', () => {
  const auth = read('js/auth.js');
  const detail = read('js/components/jobDetail.js');

  assert.match(auth, /department === 'Manager'[\s\S]*job\?\.isOtherProduction/);
  assert.match(detail, /canEditDueDates\(job\)/);
  assert.match(detail, /added to the production calendar/);
});
