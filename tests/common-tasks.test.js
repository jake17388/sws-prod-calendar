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

test('finishing the final Paint task automatically hands the job to Assembly', () => {
  const { context } = loadBackend();
  const completedAt = '2026-08-10T15:30:00.000Z';
  const state = {
    departments: ['Paint'],
    currentDepartments: ['Paint'],
    departmentChecklists: {
      Paint: [{ id: 'paint-1', text: 'Final coat', done: true, doneBy: 'Pat Painter', doneById: 'painter-1', doneAt: completedAt }],
    },
  };
  const previousPaint = [{ id: 'paint-1', text: 'Final coat', done: false }];

  const result = context.advancePaintToAssembly(state, previousPaint, { id: 'painter-1', name: 'Pat Painter' }, completedAt);

  assert.deepEqual(JSON.parse(JSON.stringify(result.departments)), ['Paint', 'Assembly']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.currentDepartments)), ['Assembly']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.departmentChecklists.Assembly)), [{
    id: 'uuid-1',
    text: 'Prep for Install',
    done: false,
    doneBy: '',
    doneById: '',
    doneAt: '',
    addedBy: 'Pat Painter',
    addedById: 'painter-1',
    addedAt: completedAt,
  }]);
});

test('the Paint handoff preserves an existing open Assembly task and does not run twice', () => {
  const { context } = loadBackend();
  const assemblyTask = { id: 'assembly-1', text: 'Existing prep', done: false, addedBy: 'Morgan' };
  const state = {
    departments: ['Paint', 'Assembly'],
    currentDepartments: ['Paint'],
    departmentChecklists: {
      Paint: [{ id: 'paint-1', text: 'Final coat', done: true }],
      Assembly: [assemblyTask],
    },
  };

  const handedOff = context.advancePaintToAssembly(state, [{ id: 'paint-1', done: false }], { id: 'p1', name: 'Pat' }, '2026-08-10T15:30:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(handedOff.departmentChecklists.Assembly)), [assemblyTask]);
  assert.deepEqual(JSON.parse(JSON.stringify(handedOff.currentDepartments)), ['Assembly']);

  const repeated = context.advancePaintToAssembly(handedOff, handedOff.departmentChecklists.Paint, { id: 'p1', name: 'Pat' }, '2026-08-10T15:31:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(repeated)), JSON.parse(JSON.stringify(handedOff)));
});
