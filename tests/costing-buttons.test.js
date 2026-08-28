const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackend(initialProperties = {}) {
  const values = { ...initialProperties };
  let uuid = 0;
  const properties = {
    getProperty: key => values[key] ?? null,
    setProperty: (key, value) => { values[key] = value; },
    deleteProperty: key => { delete values[key]; },
  };
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Map,
    Set,
    PropertiesService: { getScriptProperties: () => properties },
    Utilities: { getUuid: () => `costing-${++uuid}` },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8'), context);
  return { context, values };
}

test('costing buttons begin with the three production defaults', () => {
  const { context } = loadBackend();
  assert.deepEqual(JSON.parse(JSON.stringify(context.getCostingButtons())), [
    { id: 'loading-unloading', text: 'Loading/Unloading' },
    { id: 'team-support', text: 'Team Support' },
    { id: 'pm-sales', text: 'PM/Sales' },
  ]);
});

test('Admins and Costing Viewers can replace costing buttons with stable trimmed records', () => {
  for (const department of ['Admin', 'Costing Viewer']) {
    const { context, values } = loadBackend();
    const result = context.saveCostingButtons(
      { name: 'Costing editor', department },
      { buttons: [{ id: 'team-support', text: '  Team Assist  ' }, { text: 'Shop Cleanup' }] },
    );
    assert.equal(result.success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.buttons)), [
      { id: 'team-support', text: 'Team Assist' },
      { id: 'costing-1', text: 'Shop Cleanup' },
    ]);
    assert.deepEqual(JSON.parse(values.COSTING_BUTTONS), JSON.parse(JSON.stringify(result.buttons)));
  }
});

test('other roles cannot edit costing buttons and an intentionally empty list stays empty', () => {
  const { context, values } = loadBackend();
  const forbidden = context.saveCostingButtons(
    { name: 'Pat', department: 'Paint' },
    { buttons: [{ text: 'Not allowed' }] },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(forbidden)), { success: false, error: 'forbidden' });
  assert.equal(values.COSTING_BUTTONS, undefined);

  const cleared = context.saveCostingButtons({ department: 'Costing Viewer' }, { buttons: [] });
  assert.equal(cleared.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getCostingButtons())), []);
});

test('costing buttons reject blank, duplicate, oversized, and malformed records', () => {
  const { context } = loadBackend();
  const actor = { department: 'Admin' };
  assert.equal(context.saveCostingButtons(actor, { buttons: [{ text: ' ' }] }).success, false);
  assert.equal(context.saveCostingButtons(actor, { buttons: [{ text: 'Same' }, { text: 'same' }] }).success, false);
  assert.equal(context.saveCostingButtons(actor, { buttons: [{ id: 'same', text: 'First' }, { id: 'same', text: 'Second' }] }).success, false);
  assert.equal(context.saveCostingButtons(actor, { buttons: [{ id: 'bad id', text: 'Valid' }] }).success, false);
  assert.equal(context.saveCostingButtons(actor, { buttons: Array.from({ length: 26 }, (_, i) => ({ text: `Button ${i}` })) }).success, false);
});
