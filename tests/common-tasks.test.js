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
    Utilities: { getUuid: () => `uuid-${++uuid}` },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');
  vm.runInContext(source, context);
  return { context, values };
}

test('Manager can save trimmed common task phrases for all or selected departments', () => {
  const { context, values } = loadBackend();
  const result = context.saveCommonTasks(
    { name: 'Morgan', department: 'Manager' },
    {
      tasks: [
        { text: '  Print install packet  ', allDepartments: true, departments: ['Graphics'] },
        { id: 'existing', text: 'Prep hardware', allDepartments: false, departments: ['Assembly', 'Assembly', 'Paint'] },
      ],
    },
  );

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tasks)), [
    { id: 'uuid-1', text: 'Print install packet', allDepartments: true, departments: [] },
    { id: 'existing', text: 'Prep hardware', allDepartments: false, departments: ['Assembly', 'Paint'] },
  ]);
  assert.deepEqual(JSON.parse(values.COMMON_TASKS), JSON.parse(JSON.stringify(result.tasks)));
});

test('non-managers cannot replace common task phrases', () => {
  const original = JSON.stringify([{ id: 'one', text: 'Existing', allDepartments: true, departments: [] }]);
  const { context, values } = loadBackend({ COMMON_TASKS: original });
  const result = context.saveCommonTasks(
    { name: 'Pat', department: 'Paint' },
    { tasks: [{ text: 'Not allowed', allDepartments: true, departments: [] }] },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: false, error: 'forbidden' });
  assert.equal(values.COMMON_TASKS, original);
});

test('common task phrases require text and at least one department unless assigned to all', () => {
  const { context } = loadBackend();
  const actor = { name: 'Alex', department: 'Admin' };

  assert.equal(context.saveCommonTasks(actor, { tasks: [{ text: ' ', allDepartments: true }] }).success, false);
  assert.equal(context.saveCommonTasks(actor, { tasks: [{ text: 'Prep hardware', departments: [] }] }).success, false);
  assert.equal(context.saveCommonTasks(actor, { tasks: [{ text: 'Prep hardware', departments: ['Unknown'] }] }).success, false);
});

test('new checklist tasks receive an immutable added-by timestamp', () => {
  const { context } = loadBackend();
  const first = context.stampChecklistItem(
    { id: 'task-1', text: 'Prep hardware', done: false },
    null,
    'Morgan Manager',
  );
  assert.equal(first.addedBy, 'Morgan Manager');
  assert.match(first.addedAt, /^\d{4}-\d{2}-\d{2}T/);

  const edited = context.stampChecklistItem(
    { id: 'task-1', text: 'Prep all hardware', done: false },
    first,
    'Another Manager',
  );
  assert.equal(edited.addedBy, first.addedBy);
  assert.equal(edited.addedAt, first.addedAt);
});
