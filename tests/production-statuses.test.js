const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Code.js'), 'utf8');

// Script Properties are the only persistence the status configuration uses, so
// the fake below is enough to exercise get/save round-trips in isolation.
function loadBackend(properties = {}) {
  const store = { ...properties };
  const context = vm.createContext({
    console, Date, JSON, Map, Set,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (key in store ? store[key] : null),
        setProperty: (key, value) => { store[key] = value; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  vm.runInContext(source, context);
  context.__store = store;
  return context;
}

test('the milestone index is scraped from Squarecoil report links', () => {
  const context = loadBackend();

  const index = context.squarecoilParseMilestoneIndex_(`
    <ul class="report-nav">
      <li><a href="milestone_report.php?id=12&amp;multiple_location_id=">Pre-Production Approval</a></li>
      <li><a href="/milestone_report.php?id=30">Project Handoff</a></li>
      <li><a href="milestone_report.php?id=31">Graphics</a></li>
      <li><a href="milestone_report.php?id=31">Graphics</a></li>
      <li><a href="project.php?id=261423">Not a milestone</a></li>
      <li><a href="milestone_report.php?id=33"></a></li>
    </ul>
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(index)), [
    { id: '12', name: 'Pre-Production Approval' },
    { id: '30', name: 'Project Handoff' },
    { id: '31', name: 'Graphics' },
  ]);
});

test('the milestone index also reads a milestone select when links are absent', () => {
  const context = loadBackend();

  const index = context.squarecoilParseMilestoneIndex_(`
    <select name="other_filter"><option value="99">Ignore me</option></select>
    <select id="milestone_id">
      <option value="">Choose…</option>
      <option value="34">Manufacturing</option>
      <option value="35">Assembly</option>
    </select>
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(index)), [
    { id: '34', name: 'Manufacturing' },
    { id: '35', name: 'Assembly' },
  ]);
});

test('milestone ids resolve case-insensitively and fall back to the seeded ids', () => {
  const context = loadBackend();
  const index = [{ id: '31', name: 'Graphics' }];

  assert.equal(context.squarecoilMilestoneIdForStatus_('graphics', index), '31');
  assert.equal(context.squarecoilMilestoneIdForStatus_('  GRAPHICS  ', index), '31');
  // Project Handoff's id is seeded in config so the queue keeps working even
  // when the index scrape comes back empty.
  assert.equal(context.squarecoilMilestoneIdForStatus_('Project Handoff', []), '30');
  assert.equal(context.squarecoilMilestoneIdForStatus_('Assembly', []), '');
});

test('milestone rows are normalized against the status that was requested', () => {
  const context = loadBackend();

  const jobs = context.squarecoilParseMilestoneJobs_({
    data: [
      {
        project_id: '261423',
        project_name: 'JLL, PDS- Global Luxury Fountain Hills',
        address_1: '16872 E Ave of the Fountains',
        city: 'Fountain Hills',
        state: 'AZ',
        zip: '85268',
        project_status: 'Manufacturing',
      },
      { project_id: '261999', project_name: 'Already moved on', project_status: 'Assembly' },
      { project_id: 'not-a-job', project_name: 'Invalid', project_status: 'Manufacturing' },
    ],
  }, 'Manufacturing');

  assert.deepEqual(JSON.parse(JSON.stringify(jobs)), [{
    jobNum: '261423',
    title: 'JLL, PDS- Global Luxury Fountain Hills',
    addr: '16872 E Ave of the Fountains, Fountain Hills, AZ 85268',
    squarecoilStatus: 'Manufacturing',
  }]);
});

test('a job carried by two statuses is listed once, under the first configured status', () => {
  const context = loadBackend();

  const deduped = context.dedupeProductionStatusJobs_([
    { jobNum: '261423', title: 'Graphics copy', addr: '', squarecoilStatus: 'Graphics' },
    { jobNum: '261380', title: 'Delivery', addr: '', squarecoilStatus: 'Graphics' },
    { jobNum: '261423', title: 'Manufacturing copy', addr: '', squarecoilStatus: 'Manufacturing' },
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped.filter(job => job.jobNum === '261423').length, 1);
  assert.equal(deduped.find(job => job.jobNum === '261423').squarecoilStatus, 'Graphics');
});

test('production jobs already on the install calendar are not duplicated', () => {
  const context = loadBackend();
  const calendarJobs = [{ jobKey: '261423', jobNum: '261423', title: 'Calendar copy', dueDate: '2026-09-10' }];
  const statusJobs = [
    { jobNum: '261423', title: 'Duplicate', addr: '', squarecoilStatus: 'Manufacturing' },
    { jobNum: '261383', title: 'Customer pickup', addr: '4401 E McKellips', squarecoilStatus: 'Project Handoff' },
    { jobNum: '261380', title: 'Delivery', addr: '1050 E Carver Rd', squarecoilStatus: 'Assembly' },
  ];
  const tracking = {
    261383: { dueOverride: '2026-09-18', notes: [{ id: 'n1', text: 'Pickup', author: 'Jake' }] },
  };

  const merged = context.mergeProductionStatusJobs_(calendarJobs, statusJobs, tracking);
  const copiesOfCalendarJob = merged.filter(job => job.jobNum === '261423');
  const scheduledPickup = merged.find(job => job.jobNum === '261383');
  const unscheduledDelivery = merged.find(job => job.jobNum === '261380');

  assert.equal(copiesOfCalendarJob.length, 1);
  assert.equal(copiesOfCalendarJob[0].title, 'Calendar copy');
  assert.equal(scheduledPickup.isOtherProduction, true);
  assert.equal(scheduledPickup.squarecoilStatus, 'Project Handoff');
  assert.equal(scheduledPickup.dueDate, '2026-09-18');
  assert.equal(unscheduledDelivery.squarecoilStatus, 'Assembly');
  assert.equal(unscheduledDelivery.dueDate, '');
});

test('a new installation gets the five default production statuses', () => {
  const context = loadBackend();

  assert.deepEqual(context.getProductionStatuses(), [
    'Project Handoff',
    'Pre-Production Approval',
    'Graphics',
    'Manufacturing',
    'Assembly',
  ]);
});

test('a saved status list is read back in the order the admin chose', () => {
  const context = loadBackend({ PRODUCTION_STATUSES: JSON.stringify(['Assembly', 'Graphics']) });

  assert.deepEqual(context.getProductionStatuses(), ['Assembly', 'Graphics']);
});

test('an explicitly emptied status list stays empty instead of reverting to defaults', () => {
  const context = loadBackend({ PRODUCTION_STATUSES: '[]' });

  assert.deepEqual(context.getProductionStatuses(), []);
});

test('only Admins may change which statuses appear', () => {
  assert.equal(loadBackend().canManageProductionStatuses('Admin'), true);
  assert.equal(loadBackend().canManageProductionStatuses('Manager'), false);
  assert.equal(loadBackend().canManageProductionStatuses('Viewer'), false);
  assert.equal(loadBackend().canManageProductionStatuses('Graphics'), false);
});

test('saving statuses rejects non-admins and validates the submitted list', () => {
  const context = loadBackend();

  assert.equal(context.saveProductionStatuses({ department: 'Manager' }, { statuses: ['Graphics'] }).success, false);
  assert.equal(context.saveProductionStatuses({ department: 'Admin' }, { statuses: 'Graphics' }).success, false);
  assert.equal(
    context.saveProductionStatuses({ department: 'Admin' }, { statuses: ['Graphics', 'graphics'] }).success,
    false,
    'duplicate statuses differing only by case must be rejected',
  );
  assert.equal(context.saveProductionStatuses({ department: 'Admin' }, { statuses: [''] }).success, false);
  assert.equal(
    context.saveProductionStatuses({ department: 'Admin' }, { statuses: new Array(41).fill(0).map((_, i) => 'S' + i) }).success,
    false,
  );
});

test('saving statuses persists a trimmed list an Admin can read back', () => {
  const context = loadBackend();

  const result = context.saveProductionStatuses(
    { department: 'Admin' },
    { statuses: ['  Manufacturing  ', 'Assembly'] },
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.statuses, ['Manufacturing', 'Assembly']);
  assert.deepEqual(context.getProductionStatuses(), ['Manufacturing', 'Assembly']);
});

test('the poll version changes when the configured statuses change', () => {
  const context = loadBackend();
  const statusJobs = [{ jobNum: '261423', title: 'Job', addr: '', squarecoilStatus: 'Graphics' }];

  const before = context.productionStatusVersion_(statusJobs);
  const after = context.productionStatusVersion_([{ ...statusJobs[0], squarecoilStatus: 'Manufacturing' }]);

  assert.notEqual(before, after);
});

test('the status configuration is captured in the configuration backup', () => {
  assert.match(source, /productionStatuses: getProductionStatuses\(\)/);
  assert.match(source, /saveProductionStatuses\(\s*\{ department: 'Admin' \}/);
});

test('the status configuration is reachable over the API for Admins only', () => {
  assert.match(source, /action === 'getProductionStatuses'/);
  assert.match(source, /data\.action === 'saveProductionStatuses'/);
  assert.match(source, /canManageProductionStatuses\(actor\.department\)/);
});
