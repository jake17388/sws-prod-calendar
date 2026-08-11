const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackend() {
  const context = vm.createContext({ console, Date, JSON, Map, Set });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8'), context);
  return context;
}

const tracking = {
  '250999': {
    completed: true,
    completedAt: '2026-06-10T16:30:00.000Z',
    completedBy: 'Morgan Manager',
    updatedAt: '2026-06-10T16:30:00.000Z',
    notes: [{ id: 'note-1', text: 'Museum monument ready for pickup', author: 'Alex', createdAt: '2026-06-10T15:00:00.000Z' }],
    departments: ['Paint', 'Assembly'],
    departmentChecklists: { Paint: [{ id: 'task-1', text: 'Paint faces', done: true }] },
    currentDepartments: [],
    additionalFiles: [],
    archiveSnapshot: {
      title: 'Downtown Museum Monument', addr: '100 Main St', crew: ['Jake'],
      startDate: '2026-06-12', endDate: '2026-06-12', dueDate: '2026-06-10',
    },
  },
  '250998': {
    completed: true,
    completedAt: '2026-05-01T12:00:00.000Z',
    completedBy: 'Ada Admin',
    updatedAt: '2026-05-01T12:00:00.000Z',
    notes: [{ id: 'note-2', text: 'Legacy record', author: 'Ada', createdAt: '2026-05-01T11:00:00.000Z' }],
    departments: ['Routing'], departmentChecklists: {}, currentDepartments: [], additionalFiles: [],
  },
  '260100': {
    completed: false, updatedAt: '2026-08-11T12:00:00.000Z', notes: [],
    departments: ['Paint'], departmentChecklists: {}, currentDepartments: ['Paint'], additionalFiles: [],
  },
};

test('archive search returns completed history and preserves a saved job snapshot', () => {
  const context = loadBackend();
  context.getAllTracking = () => tracking;

  const result = context.searchArchivedJobs({ department: 'Admin' }, 'museum');

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].jobKey, '250999');
  assert.equal(result.jobs[0].title, 'Downtown Museum Monument');
  assert.equal(result.jobs[0].notes[0].text, 'Museum monument ready for pickup');
  assert.equal(result.jobs[0].completed, true);
});

test('archive search finds legacy history and enforces production department access', () => {
  const context = loadBackend();
  context.getAllTracking = () => tracking;

  const paint = context.searchArchivedJobs({ department: 'Paint' }, '250');
  const routing = context.searchArchivedJobs({ department: 'Routing' }, '250');

  assert.deepEqual(Array.from(paint.jobs, job => job.jobKey), ['250999']);
  assert.deepEqual(Array.from(routing.jobs, job => job.jobKey), ['250998']);
  assert.equal(routing.jobs[0].title, 'Archived job 250998');
});

test('archive rejects oversized searches and sorts recent completions first', () => {
  const context = loadBackend();
  context.getAllTracking = () => tracking;

  assert.equal(context.searchArchivedJobs({ department: 'Admin' }, 'x'.repeat(81)).error, 'Search is too long');
  assert.deepEqual(
    Array.from(context.searchArchivedJobs({ department: 'Viewer' }, '').jobs, job => job.jobKey),
    ['250999', '250998'],
  );
});

test('completion snapshots accept only bounded display metadata', () => {
  const context = loadBackend();
  const snapshot = context.normalizeArchiveSnapshot('250999', {
    jobNum: '250999', title: ' Downtown Museum ', addr: ' 100 Main St ', crew: ['Jake'],
    startDate: '2026-06-12', endDate: '2026-06-12', dueDate: '2026-06-10',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    title: 'Downtown Museum', addr: '100 Main St', crew: ['Jake'],
    startDate: '2026-06-12', endDate: '2026-06-12', dueDate: '2026-06-10',
  });
  assert.equal(context.normalizeArchiveSnapshot('250999', { jobNum: 'wrong', title: 'Nope' }), null);
});
