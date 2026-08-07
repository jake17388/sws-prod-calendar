import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPendingNote,
  preservePendingNotesInJobs,
  removePendingNote,
  settlePendingNote,
} from '../js/optimisticNotes.mjs';

test('a submitted note appears immediately with a saving state', () => {
  const original = [{ id: 'old', text: 'Existing note' }];
  const next = addPendingNote(original, {
    id: 'local-1',
    text: 'Call customer',
    author: 'Jake Banks',
    createdAt: '2026-08-07T17:00:00.000Z',
  });

  assert.equal(original.length, 1);
  assert.deepEqual(next[1], {
    id: 'local-1',
    text: 'Call customer',
    author: 'Jake Banks',
    createdAt: '2026-08-07T17:00:00.000Z',
    pending: true,
  });
});

test('a saved response settles only its own note and preserves newer pending notes', () => {
  const local = [
    { id: 'old', text: 'Existing note' },
    { id: 'local-1', text: 'First', pending: true },
    { id: 'local-2', text: 'Second', pending: true },
  ];
  const server = [
    { id: 'old', text: 'Existing note' },
    { id: 'local-1', text: 'First', author: 'Jake Banks', createdAt: '2026-08-07T17:00:00.000Z' },
  ];

  const settled = settlePendingNote(local, 'local-1', server);
  assert.equal(settled[1].pending, undefined);
  assert.equal(settled[2].pending, true);
  assert.equal(settled[2].id, 'local-2');
});

test('a failed save removes only the failed optimistic note', () => {
  const local = [
    { id: 'old', text: 'Existing note' },
    { id: 'local-1', text: 'First', pending: true },
    { id: 'local-2', text: 'Second', pending: true },
  ];
  assert.deepEqual(removePendingNote(local, 'local-1').map(note => note.id), ['old', 'local-2']);
});

test('a background job refresh cannot erase a note that is still saving', () => {
  const current = [{
    jobKey: 'job-1',
    notes: [{ id: 'local-1', text: 'Call customer', pending: true }],
    departmentNotes: { Paint: [{ id: 'local-2', text: 'Match color', pending: true }] },
  }];
  const refreshed = [{ jobKey: 'job-1', notes: [], departmentNotes: { Paint: [] } }];

  const merged = preservePendingNotesInJobs(current, refreshed);
  assert.equal(merged[0].notes[0].id, 'local-1');
  assert.equal(merged[0].departmentNotes.Paint[0].id, 'local-2');
});
