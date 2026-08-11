import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Project Notes spans the full project panel and uses a readable timeline', () => {
  const html = read('index.html');
  const css = read('styles/job-detail.css');
  const notes = read('js/components/notes.js');

  assert.match(html, /class="job-detail-section project-notes-section"/);
  assert.match(css, /\.project-notes-section\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(notes, /note-item-avatar/);
  assert.match(notes, /note-item-author/);
  assert.match(notes, /note-item-time/);
});

test('note composer exposes its limit, live count, and keyboard save shortcut', () => {
  const notes = read('js/components/notes.js');

  assert.match(notes, /textarea\.maxLength\s*=\s*2000/);
  assert.match(notes, /notes-character-count/);
  assert.match(notes, /event\.key\s*===\s*['"]Enter['"]\s*&&\s*\(event\.metaKey\s*\|\|\s*event\.ctrlKey\)/);
});
