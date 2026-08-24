const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function backendContext() {
  const context = vm.createContext({ console, Date, JSON, Map, Set });
  vm.runInContext(fs.readFileSync(path.join(root, 'Code.js'), 'utf8'), context);
  return context;
}

test('TV is an Admin-managed display role with all-job visibility and no write access', () => {
  const context = backendContext();
  const tv = { id: 'prod-tv', name: 'Prod TV', department: 'TV' };

  assert.equal(vm.runInContext("DEPARTMENTS.includes('TV')", context), true);
  assert.equal(context.canManageDepartment('Admin', 'TV'), true);
  assert.equal(context.canManageDepartment('Manager', 'TV'), false);
  assert.equal(context.canAccessJobKey(tv, { departments: ['Paint'] }), true);
  assert.equal(context.canAssignDepartments('TV'), false);
  assert.equal(context.canUseJobSelector('TV'), false);
  assert.equal(context.canUploadAdditionalFiles('TV'), false);
  assert.equal(context.canWriteNote(tv), false);
});

test('TV frontend locks the account to a compact current-week display', () => {
  const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const tvCss = fs.readFileSync(path.join(root, 'styles/tv.css'), 'utf8');

  assert.match(config, /DEPARTMENTS\s*=\s*\[[^\]]*'TV'/);
  assert.match(auth, /isTvDisplay/);
  assert.match(auth, /department\s*!==\s*'TV'/);
  assert.match(app, /classList\.toggle\('tv-mode'/);
  assert.match(app, /if\s*\(isTvDisplay\(\)\)[\s\S]{0,180}activeView\s*=\s*'week'/);
  assert.match(app, /last-updated[\s\S]{0,500}refresh-btn[\s\S]{0,500}user-badge/);
  assert.match(html, /styles\/tv\.css/);
  assert.match(tvCss, /body\.tv-mode\s+\.toolbar-row[\s\S]{0,300}display:\s*none/);
  assert.match(tvCss, /body\.tv-mode\s+\.nav-row[\s\S]{0,300}display:\s*none/);
  assert.match(tvCss, /body\.tv-mode\s+\.mobile-view-switcher[\s\S]{0,300}display:\s*none/);
  assert.match(tvCss, /grid-template-columns:\s*repeat\(7/);
  assert.match(tvCss, /body\.tv-mode\s+\.job-card-dept-badges[\s\S]{0,100}display:\s*none/);
  assert.match(tvCss, /-webkit-line-clamp:\s*unset/);
});
