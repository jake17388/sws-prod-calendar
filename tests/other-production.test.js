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

test('Squarecoil Project Handoff rows are normalized into production job metadata', () => {
  const context = loadBackend();
  const jobs = context.squarecoilParseProjectHandoffJobs_({
    data: [
      {
        project_id: '261423',
        project_name: 'JLL, PDS- Global Luxury Fountain Hills',
        address_1: '16872 E Ave of the Fountains',
        city: 'Fountain Hills',
        state: 'AZ',
        zip: '85268',
        project_status: 'Project Handoff',
      },
      {
        project_id: '261999',
        project_name: 'Already moved on',
        project_status: 'Manufacturing',
      },
      { project_id: 'not-a-job', project_name: 'Invalid' },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(jobs)), [{
    jobNum: '261423',
    title: 'JLL, PDS- Global Luxury Fountain Hills',
    addr: '16872 E Ave of the Fountains, Fountain Hills, AZ 85268',
    squarecoilStatus: 'Project Handoff',
  }]);
});

test('Project Handoff jobs already present on the install calendar are not duplicated', () => {
  const context = loadBackend();
  const calendarJobs = [{ jobKey: '261423', jobNum: '261423', title: 'Calendar copy', dueDate: '2026-09-10' }];
  const handoffJobs = [
    { jobNum: '261423', title: 'Duplicate', addr: '', squarecoilStatus: 'Project Handoff' },
    { jobNum: '261383', title: 'Customer pickup', addr: '4401 E McKellips', squarecoilStatus: 'Project Handoff' },
    { jobNum: '261380', title: 'Delivery', addr: '1050 E Carver Rd', squarecoilStatus: 'Project Handoff' },
  ];
  const tracking = {
    261383: { dueOverride: '2026-09-18', notes: [{ id: 'n1', text: 'Pickup', author: 'Jake' }] },
  };

  const merged = context.mergeProjectHandoffJobs_(calendarJobs, handoffJobs, tracking);
  const copiesOfCalendarJob = merged.filter(job => job.jobNum === '261423');
  const scheduledPickup = merged.find(job => job.jobNum === '261383');
  const unscheduledDelivery = merged.find(job => job.jobNum === '261380');

  assert.equal(copiesOfCalendarJob.length, 1);
  assert.equal(copiesOfCalendarJob[0].title, 'Calendar copy');
  assert.equal(scheduledPickup.isOtherProduction, true);
  assert.equal(scheduledPickup.dueDate, '2026-09-18');
  assert.equal(scheduledPickup.dueOverride, '2026-09-18');
  assert.equal(unscheduledDelivery.isOtherProduction, true);
  assert.equal(unscheduledDelivery.dueDate, '');
  assert.equal(unscheduledDelivery.startDate, '');
});

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
