import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const { createJobNoteState, shouldSaveJobNote, jobNoteShortcut } = await import('../js/jobNoteModal.mjs');

test('opening with an empty note creates an unchanged empty draft', () => {
  const state = createJobNoteState({ entryId: 'entry-1', jobNum: '260001', jobName: 'Lobby sign', note: '' });

  assert.equal(state.savedNote, '');
  assert.equal(state.draft, '');
  assert.equal(state.dirty, false);
  assert.equal(shouldSaveJobNote(state), false);
});

test('opening with an existing note prefills the saved note', () => {
  const state = createJobNoteState({ entryId: 'entry-2', jobNum: '260002', jobName: 'Monument', note: 'Waiting on paint' });

  assert.equal(state.savedNote, 'Waiting on paint');
  assert.equal(state.draft, 'Waiting on paint');
  assert.equal(state.dirty, false);
});

test('saving a changed note trims its outer whitespace', () => {
  const state = createJobNoteState({ entryId: 'entry-3', note: 'Old note' });
  state.setDraft('  Updated note\n  ');

  assert.equal(state.dirty, true);
  assert.equal(shouldSaveJobNote(state), true);
  assert.equal(state.valueToSave(), 'Updated note');
});

test('clearing an existing note saves an empty value', () => {
  const state = createJobNoteState({ entryId: 'entry-4', note: 'Remove this' });
  state.setDraft('   ');

  assert.equal(state.dirty, true);
  assert.equal(state.valueToSave(), '');
});

test('canceling without changes can close immediately', () => {
  const state = createJobNoteState({ entryId: 'entry-5', note: 'Keep this' });

  assert.equal(state.canCloseWithoutConfirmation(), true);
});

test('an unsaved draft is protected from accidental close', () => {
  const state = createJobNoteState({ entryId: 'entry-6', note: 'Saved' });
  state.setDraft('Unsaved change');

  assert.equal(state.canCloseWithoutConfirmation(), false);
});

test('a save failure preserves the draft and permits retry', async () => {
  const state = createJobNoteState({ entryId: 'entry-7', note: 'Saved' });
  state.setDraft('Draft survives');

  await assert.rejects(state.save(async () => { throw new Error('Network unavailable'); }), /Network unavailable/);
  assert.equal(state.draft, 'Draft survives');
  assert.equal(state.saving, false);
  assert.equal(state.dirty, true);

  const saved = await state.save(async value => ({ success: true, notes: value }));
  assert.equal(saved.notes, 'Draft survives');
  assert.equal(state.savedNote, 'Draft survives');
  assert.equal(state.dirty, false);
});

test('Cmd+Enter and Ctrl+Enter trigger save while plain Enter does not', () => {
  assert.equal(jobNoteShortcut({ key: 'Enter', metaKey: true, ctrlKey: false }), 'save');
  assert.equal(jobNoteShortcut({ key: 'Enter', metaKey: false, ctrlKey: true }), 'save');
  assert.equal(jobNoteShortcut({ key: 'Enter', metaKey: false, ctrlKey: false }), null);
  assert.equal(jobNoteShortcut({ key: 'Escape', metaKey: false, ctrlKey: false }), 'close');
});

test('the job selector renders an accessible custom dialog and labeled note area', () => {
  const view = read('js/views/jobSelector.js');
  const css = read('styles/job-selector.css');

  assert.doesNotMatch(view, /window\.prompt/);
  assert.match(view, /role="dialog"/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, />Job note</);
  assert.match(view, />Note</);
  assert.match(view, /Add progress, issues, materials needed, or handoff details…/);
  assert.match(view, /Save note/);
  assert.match(view, /Add job note/);
  assert.match(view, /Edit job note/);
  assert.match(view, /job-selector-note-edit\$\{entry\.notes \? ' has-note' : ''\}/);
  assert.match(css, /job-note-modal/);
  assert.match(css, /@media \(max-width:\s*600px\)/);
  assert.match(css, /:focus-visible/);
});
