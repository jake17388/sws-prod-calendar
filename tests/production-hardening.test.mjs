import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('tracking backups meet the one-hour recovery point objective', () => {
  const backend = read('Code.js');
  assert.match(backend, /BACKUP_INTERVAL_HOURS\s*=\s*1/);
  assert.match(backend, /everyHours\(BACKUP_INTERVAL_HOURS\)/);
  assert.match(backend, /LAST_BACKUP_AT/);
  assert.match(backend, /BACKUP_RETENTION_COUNT\s*=\s*168/);
});

test('recovery includes configuration snapshots and tested restore tools', () => {
  const backend = read('Code.js');
  const runbook = read('docs/ROLLBACK.md');
  assert.match(backend, /backupConfigurationSnapshot/);
  assert.match(backend, /restoreTrackingSpreadsheetFromBackup/);
  assert.match(backend, /restoreConfigurationFromBackup/);
  assert.match(runbook, /Data restore/i);
  assert.match(runbook, /one hour/i);
  assert.match(runbook, /recovery drill/i);
});

test('Admins can see operational health and backup failures', () => {
  const backend = read('Code.js');
  const api = read('js/api.js');
  const settings = read('index.html');
  assert.match(backend, /getSystemHealth/);
  assert.match(backend, /LAST_OPERATIONAL_FAILURE/);
  assert.match(api, /fetchSystemHealth/);
  assert.match(settings, /id="system-health-section"/);
  assert.match(settings, /id="system-health-backup"/);
});

test('temporary PINs are visible to managers and must be replaced by the user', () => {
  const backend = read('Code.js');
  const auth = read('js/auth.js');
  const app = read('js/app.js');
  const users = read('js/components/userManagement.js');
  assert.match(backend, /mustChangePin/);
  assert.match(backend, /PIN_CHANGE_STATUS_BATCH/);
  assert.match(auth, /mustChangePin/);
  assert.match(app, /pin-change-required/);
  assert.match(users, /Temporary PIN/);
});

test('the app has explicit offline and retry states', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  assert.match(html, /id="offline-banner"/);
  assert.match(app, /window\.addEventListener\('offline'/);
  assert.match(app, /window\.addEventListener\('online'/);
  assert.match(app, /Retry/);
  assert.match(app, /aria-busy/);
});

test('interactive job cards support keyboards and desktop job details use two columns', () => {
  const cards = read('js/components/jobCard.js');
  const cardCss = read('styles/job-card.css');
  const detailCss = read('styles/job-detail.css');
  assert.match(cards, /tabIndex\s*=\s*0/);
  assert.match(cards, /event\.key === 'Enter'/);
  assert.match(cardCss, /min-height:\s*44px/);
  assert.match(detailCss, /min\(900px, 100%\)/);
  assert.match(detailCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('critical browser journeys and the 30-user load check are automated', () => {
  const pkg = JSON.parse(read('package.json'));
  const ci = read('.github/workflows/ci.yml');
  assert.ok(pkg.scripts['test:e2e']);
  assert.ok(pkg.scripts['test:load']);
  assert.ok(fs.existsSync(path.join(root, 'playwright.config.js')));
  assert.ok(fs.existsSync(path.join(root, 'tests/e2e/critical-flows.spec.js')));
  assert.ok(fs.existsSync(path.join(root, 'scripts/load-simulation.mjs')));
  assert.match(ci, /test:e2e/);
  assert.match(ci, /playwright-report/);
});
