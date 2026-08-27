const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');

function loadBackend() {
  let uuid = 0;
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Map,
    Set,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty() {},
      }),
    },
    CacheService: {
      getScriptCache: () => ({ get: () => null, put() {}, remove() {} }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    Utilities: {
      getUuid: () => `entry-${++uuid}`,
    },
  });
  vm.runInContext(source, context);
  return context;
}

function createSheet(initialRows = []) {
  const rows = initialRows.map(row => row.slice());
  const ensureCell = (row, column) => {
    while (rows.length < row) rows.push([]);
    while (rows[row - 1].length < column) rows[row - 1].push('');
  };
  return {
    rows,
    getLastRow: () => rows.reduce((last, row, index) => row.some(value => value !== '') ? index + 1 : last, 0),
    getDataRange: () => ({ getValues: () => rows.map(row => row.slice()) }),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValue() {
          ensureCell(row, column);
          return rows[row - 1][column - 1];
        },
        setValue(value) {
          ensureCell(row, column);
          rows[row - 1][column - 1] = value;
          return this;
        },
        setValues(values) {
          for (let r = 0; r < rowCount; r++) {
            for (let c = 0; c < columnCount; c++) {
              ensureCell(row + r, column + c);
              rows[row + r - 1][column + c - 1] = values[r][c];
            }
          }
          return this;
        },
        setNumberFormat() { return this; },
      };
    },
    appendRow(row) { rows.push(row.slice()); },
    setFrozenRows() {},
  };
}

test('only production departments can use the Job Selector', () => {
  const context = loadBackend();

  ['Manufacturing', 'Graphics', 'Routing', 'Paint', 'Letters', 'Assembly']
    .forEach(department => assert.equal(context.canUseJobSelector(department), true));
  ['Admin', 'Manager', 'Viewer', 'Ship-In', '']
    .forEach(department => assert.equal(context.canUseJobSelector(department), false));
});

test('only Carlos and Admin accounts can view the hours log', () => {
  const context = loadBackend();

  assert.equal(context.canViewJobTimeLog({ name: 'Carlos', department: 'Paint', canViewHoursLog: true }), true);
  assert.equal(context.canViewJobTimeLog({ name: 'Any Admin', department: 'Admin' }), true);
  assert.equal(context.canViewJobTimeLog({ name: 'Carlos', department: 'Viewer' }), false);
  assert.equal(context.canViewJobTimeLog({ name: 'Carl', department: 'Paint' }), false);
  assert.equal(context.canViewJobTimeLog({ name: 'Other Worker', department: 'Paint' }), false);
  assert.equal(context.canViewJobTimeLog(null), false);
});

test('Carlos receives durable hours-log access once without granting it by future renames', () => {
  const context = loadBackend();
  const values = {};
  const props = {
    getProperty: key => values[key] || null,
    setProperty: (key, value) => { values[key] = value; },
  };
  const users = [
    { id: 'carlos-1', name: 'Carlos Garcia', department: 'Paint' },
    { id: 'other-1', name: 'Other Worker', department: 'Assembly' },
  ];

  assert.equal(context.grantCarlosHoursLogAccess(users, props), true);
  props.setProperty('HOURS_LOG_ACCESS_BATCH', '2026-08-27-carlos-hours-log');
  users[0].name = 'Carlos Renamed';
  users[1].name = 'Carlos';
  assert.equal(context.grantCarlosHoursLogAccess(users, props), false);
  assert.equal(users[0].canViewHoursLog, true);
  assert.equal(users[1].canViewHoursLog, undefined);
});

test('the blank JobTimeEntries tab receives a stable costing header without replacing it', () => {
  const context = loadBackend();
  const sheet = createSheet();
  const workbook = {
    getSheetByName: name => name === 'JobTimeEntries' ? sheet : null,
    insertSheet: () => { throw new Error('the user-created tab should be reused'); },
  };
  context.getTrackingSpreadsheet = () => workbook;

  assert.equal(context.getJobTimeEntriesSheet_(), sheet);
  assert.deepEqual(sheet.rows[0], [
    'entry_id', 'user_id', 'employee', 'department', 'job_number', 'job_name',
    'source', 'started_at', 'ended_at', 'duration_minutes', 'status',
  ]);
  const originalHeader = sheet.rows[0].slice();
  context.getJobTimeEntriesSheet_();
  assert.deepEqual(sheet.rows[0], originalHeader);
});

test('assigned selections require an unfinished task in the signed-in department', () => {
  const context = loadBackend();
  const actor = { id: 'paint-1', name: 'Pat', department: 'Paint' };
  context.getProductionJobs = () => { throw new Error('starting a timer must not rebuild the calendar'); };
  context.getAllTracking = () => ({
    '260101': {
      completed: false,
      departments: ['Paint'], departmentChecklists: { Paint: [{ id: 'p1', done: false }] },
    },
    '260102': {
      completed: false,
      departments: ['Paint'], departmentChecklists: { Paint: [{ id: 'p2', done: true }] },
    },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.resolveJobTimeSelection_(actor, {
      jobNum: '260101', jobName: 'Open Paint Job', source: 'assigned',
    }))),
    { jobNum: '260101', jobName: 'Open Paint Job', source: 'assigned' },
  );
  assert.equal(
    context.resolveJobTimeSelection_(actor, {
      jobNum: '260102', jobName: 'Finished Paint Job', source: 'assigned',
    }).error,
    'This job no longer has open tasks for Paint',
  );
});

test('Squarecoil project markup resolves the full project name and rejects mismatched pages', () => {
  const context = loadBackend();
  const html = [
    '<h1 style="font-size:48px">231180</h1>',
    '<h2><small>Higley Center for ...</small></h2>',
    '<h1>Higley Center for the Performing Arts<span class="toggle-favorite"><i></i></span></h1>',
  ].join('');

  assert.equal(context.squarecoilFindProjectName_(html, '231180'), 'Higley Center for the Performing Arts');
  assert.equal(context.squarecoilFindProjectName_(html, '260999'), '');
});

test('starting a new job closes the prior segment, while same-job retries do not duplicate rows', () => {
  const context = loadBackend();
  const sheet = createSheet([[
    'entry_id', 'user_id', 'employee', 'department', 'job_number', 'job_name',
    'source', 'started_at', 'ended_at', 'duration_minutes', 'status',
  ]]);
  const actor = { id: 'paint-1', name: 'Pat Painter', department: 'Paint' };
  let now = new Date('2026-08-24T14:00:00.000Z');
  context.getJobTimeEntriesSheet_ = () => sheet;
  context.jobTimeNow_ = () => new Date(now);
  context.resolveJobTimeSelection_ = (_actor, data) => ({
    jobNum: data.jobNum,
    jobName: data.jobNum === '260101' ? 'First Job' : 'Second Job',
    source: data.source,
  });

  const first = context.startJobTime(actor, { jobNum: '260101', source: 'assigned' });
  assert.equal(first.success, true);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][10], 'active');

  const duplicate = context.startJobTime(actor, { jobNum: '260101', source: 'assigned' });
  assert.equal(duplicate.alreadyActive, true);
  assert.equal(sheet.rows.length, 2);

  now = new Date('2026-08-24T14:45:00.000Z');
  const switched = context.startJobTime(actor, { jobNum: '260102', source: 'assigned' });
  assert.equal(switched.success, true);
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rows[1][8].toISOString(), '2026-08-24T14:45:00.000Z');
  assert.equal(sheet.rows[1][9], 45);
  assert.equal(sheet.rows[1][10], 'closed');
  assert.equal(sheet.rows[2][4], '260102');
  assert.equal(sheet.rows[2][10], 'active');
});

test('Stop Work closes the active segment and is harmless when already stopped', () => {
  const context = loadBackend();
  const sheet = createSheet([
    [
      'entry_id', 'user_id', 'employee', 'department', 'job_number', 'job_name',
      'source', 'started_at', 'ended_at', 'duration_minutes', 'status',
    ],
    ['entry-1', 'paint-1', 'Pat Painter', 'Paint', '260101', 'First Job', 'assigned', new Date('2026-08-24T14:00:00.000Z'), '', '', 'active'],
  ]);
  const actor = { id: 'paint-1', name: 'Pat Painter', department: 'Paint' };
  context.getJobTimeEntriesSheet_ = () => sheet;
  context.jobTimeNow_ = () => new Date('2026-08-24T14:30:00.000Z');

  const stopped = context.stopJobTime(actor);
  assert.equal(stopped.success, true);
  assert.equal(stopped.stopped, true);
  assert.equal(sheet.rows[1][9], 30);
  assert.equal(sheet.rows[1][10], 'closed');

  const repeated = context.stopJobTime(actor);
  assert.equal(repeated.success, true);
  assert.equal(repeated.stopped, false);
  assert.equal(sheet.rows.length, 2);
});

test('the protected hours log returns newest sheet entries first', () => {
  const context = loadBackend();
  const sheet = createSheet([
    [
      'entry_id', 'user_id', 'employee', 'department', 'job_number', 'job_name',
      'source', 'started_at', 'ended_at', 'duration_minutes', 'status',
    ],
    ['entry-1', 'paint-1', 'Pat Painter', 'Paint', '260101', 'First Job', 'assigned', new Date('2026-08-24T14:00:00.000Z'), new Date('2026-08-24T14:30:00.000Z'), 30, 'closed'],
    ['entry-2', 'assembly-1', 'Alex Assembler', 'Assembly', '260102', 'Second Job', 'other', new Date('2026-08-24T15:00:00.000Z'), '', '', 'active'],
  ]);
  context.getJobTimeEntriesSheet_ = () => sheet;

  const result = context.getJobTimeLog({ id: 'admin-1', name: 'Ada', department: 'Admin' });
  assert.equal(result.success, true);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.entries[0])), {
    entryId: 'entry-2', userId: 'assembly-1', employee: 'Alex Assembler', department: 'Assembly',
    jobNum: '260102', jobName: 'Second Job', source: 'other',
    startedAt: '2026-08-24T15:00:00.000Z', endedAt: '', durationMinutes: null, status: 'active',
  });
  assert.equal(result.entries[1].durationMinutes, 30);
  assert.equal(context.getJobTimeLog({ name: 'Other Worker', department: 'Paint' }).error, 'forbidden');
});
