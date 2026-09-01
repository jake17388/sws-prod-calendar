const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Code.js'), 'utf8');

function loadBackend() {
  const context = vm.createContext({ console, Date, JSON, Map, Set });
  vm.runInContext(source, context);
  return context;
}

test('Managers can schedule only Other Production jobs while Admins retain all due-date access', () => {
  const context = loadBackend();

  assert.equal(context.canEditDueDateForJob('Admin', { isOtherProduction: false }), true);
  assert.equal(context.canEditDueDateForJob('Manager', { isOtherProduction: true }), true);
  assert.equal(context.canEditDueDateForJob('Manager', { isOtherProduction: false }), false);
  assert.equal(context.canEditDueDateForJob('Viewer', { isOtherProduction: true }), false);
});

test('only Admin, Manager, and Viewer roles receive the Other Production queue', () => {
  const context = loadBackend();

  assert.equal(context.canViewOtherProduction('Admin'), true);
  assert.equal(context.canViewOtherProduction('Manager'), true);
  assert.equal(context.canViewOtherProduction('Viewer'), true);
  assert.equal(context.canViewOtherProduction('Costing Viewer'), false);
  assert.equal(context.canViewOtherProduction('Graphics'), false);
  assert.equal(context.canViewOtherProduction('TV'), false);
});
