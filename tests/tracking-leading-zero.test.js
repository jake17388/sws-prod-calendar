const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const headers = [
  'job_key', 'completed', 'notes', 'checklist_json', 'updated_at', 'updated_by',
  'completed_at', 'completed_by', 'due_override', 'departments_json',
  'department_checklists_json', 'current_departments_json',
  'department_notes_json', 'additional_files_json', 'archive_snapshot_json',
];

function trackingRow(jobKey, completed = false) {
  return [jobKey, completed, '[]', '[]', '', '', '', '', '', '[]', '{}', '[]', '{}', '[]', 'null'];
}

function createSheet(initialRows = []) {
  const rows = [headers, ...initialRows.map(row => row.slice())];
  const textCells = new Set();
  const range = (startRow, startColumn, rowCount = 1, columnCount = 1) => ({
    setNumberFormat(format) {
      if (format === '@') {
        for (let row = startRow; row < startRow + rowCount; row++) {
          for (let column = startColumn; column < startColumn + columnCount; column++) {
            textCells.add(`${row}:${column}`);
          }
        }
      }
      return this;
    },
    setValues(values) {
      values.forEach((sourceRow, rowOffset) => {
        const rowIndex = startRow - 1 + rowOffset;
        if (!rows[rowIndex]) rows[rowIndex] = [];
        sourceRow.forEach((value, columnOffset) => {
          const column = startColumn + columnOffset;
          const isNumericText = typeof value === 'string' && /^\d+$/.test(value);
          rows[rowIndex][column - 1] = isNumericText && !textCells.has(`${rowIndex + 1}:${column}`)
            ? Number(value)
            : value;
        });
      });
      return this;
    },
  });

  return {
    rows,
    appendRow(sourceRow) {
      rows.push(sourceRow.map(value => (
        typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
      )));
    },
    getDataRange: () => ({ getValues: () => rows.map(row => row.slice()) }),
    getLastRow: () => rows.length,
    getRange: range,
  };
}

function loadBackend(sheet) {
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Map,
    Set,
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8'), context);
  context.getTrackingSheet = () => sheet;
  context.bumpTrackingVersion = () => {};
  return context;
}

test('new tracking rows preserve a leading-zero job key as plain text', () => {
  const sheet = createSheet();
  const context = loadBackend(sheet);

  assert.equal(context.setTracking('00001', { completed: true }, 'Jake B').success, true);
  assert.equal(sheet.rows[1][0], '00001');
  assert.equal(context.getAllTracking()['00001'].completed, true);
});

test('calendar reads recover a legacy numeric tracking key for a leading-zero job', () => {
  const sheet = createSheet([trackingRow(1, true)]);
  const context = loadBackend(sheet);
  const tracking = context.getAllTracking();

  assert.equal(context.trackingForJobKey_(tracking, '00001').completed, true);
});

test('the next write migrates a legacy numeric key instead of appending a duplicate row', () => {
  const sheet = createSheet([trackingRow(1, false)]);
  const context = loadBackend(sheet);

  assert.equal(context.setTracking('00001', { completed: true }, 'Jake B').success, true);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][0], '00001');
  assert.equal(context.getAllTracking()['00001'].completed, true);
});
