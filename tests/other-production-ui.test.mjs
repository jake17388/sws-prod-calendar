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

test('the Other Production queue is described by the configured statuses, not a fixed one', () => {
  const view = read('js/views/otherProduction.js');
  const detail = read('js/components/jobDetail.js');

  // The heading and the job-detail meta line both used to hardcode
  // "Project Handoff"; they now follow whatever status the job came in on.
  assert.doesNotMatch(view, /Project Handoff/);
  assert.doesNotMatch(detail, /Project Handoff/);
  assert.match(detail, /job\.squarecoilStatus/);
});

test('Admins get a Production Statuses settings subpage', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const auth = read('js/auth.js');
  const api = read('js/api.js');

  assert.match(html, /id="settings-production-statuses-btn"[^>]*>Production Statuses</);
  assert.match(html, /id="production-status-overlay"/);
  assert.match(html, /id="production-status-list"/);
  assert.match(html, /id="production-status-save"/);
  assert.match(auth, /canManageProductionStatuses\s*=\s*\(\)\s*=>\s*isAdmin\(\)/);
  assert.match(api, /fetchProductionStatuses/);
  assert.match(api, /saveProductionStatuses/);
  assert.match(app, /productionStatusManagement\.js/);
  assert.match(app, /settings-production-statuses-btn'\)\.hidden = !canManageProductionStatuses\(\)/);
});

test('the Production Statuses editor offers every Squarecoil status and marks the enabled ones', () => {
  const component = read('js/components/productionStatusManagement.js');

  assert.match(component, /fetchProductionStatuses/);
  assert.match(component, /type="checkbox"/);
  assert.match(component, /saveProductionStatuses/);
  // Statuses Squarecoil could not resolve to a milestone must be called out
  // rather than silently returning no jobs.
  assert.match(component, /unresolved/i);
});
