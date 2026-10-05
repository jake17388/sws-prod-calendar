import assert from 'node:assert/strict';
import test from 'node:test';

import { createViewDates } from '../js/viewDates.mjs';

test('each calendar view preserves its own navigation date', () => {
  const initial = new Date(2026, 8, 15);
  const dates = createViewDates(initial);

  dates.set('schedule', new Date(2027, 3, 15));

  assert.equal(dates.get('month').getFullYear(), 2026);
  assert.equal(dates.get('month').getMonth(), 8);
  assert.equal(dates.get('schedule').getFullYear(), 2027);
  assert.equal(dates.get('schedule').getMonth(), 3);
});

test('stored view dates are copied so callers cannot mutate another render implicitly', () => {
  const dates = createViewDates(new Date(2026, 8, 15));
  const month = dates.get('month');
  month.setMonth(3);

  assert.equal(dates.get('month').getMonth(), 8);
});
