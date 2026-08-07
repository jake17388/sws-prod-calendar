import assert from 'node:assert/strict';
import test from 'node:test';
import { beginWrite, endWrite, hasPendingWrites, subscribePendingWrites } from '../js/pendingWrites.mjs';

test('pending write state covers overlapping saves until the final request settles', () => {
  const states = [];
  const unsubscribe = subscribePendingWrites(pending => states.push(pending));
  beginWrite();
  beginWrite();
  assert.equal(hasPendingWrites(), true);
  endWrite();
  assert.equal(hasPendingWrites(), true);
  endWrite();
  assert.equal(hasPendingWrites(), false);
  unsubscribe();
  assert.deepEqual(states, [true, true, true, false]);
});

test('extra completion calls cannot make the pending count negative', () => {
  endWrite();
  assert.equal(hasPendingWrites(), false);
});
