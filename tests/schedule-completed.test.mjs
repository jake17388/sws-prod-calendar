import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionScheduleJobs } from '../js/views/scheduleGroups.mjs';

test('schedule separates completed jobs from active jobs without changing their order', () => {
  const jobs = [
    { id: 'open-1', completed: false },
    { id: 'done-1', completed: true },
    { id: 'open-2' },
    { id: 'done-2', completed: true },
  ];

  const result = partitionScheduleJobs(jobs);

  assert.deepEqual(result.open.map(job => job.id), ['open-1', 'open-2']);
  assert.deepEqual(result.completed.map(job => job.id), ['done-1', 'done-2']);
});

test('schedule partition does not mutate the supplied jobs array', () => {
  const jobs = [{ id: 'done', completed: true }, { id: 'open', completed: false }];
  const snapshot = [...jobs];

  partitionScheduleJobs(jobs);

  assert.deepEqual(jobs, snapshot);
});
