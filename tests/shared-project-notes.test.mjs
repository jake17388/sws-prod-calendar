import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the job screen has one shared notes timeline and no department note controls', () => {
  const jobDetail = read('js/components/jobDetail.js');
  const departments = read('js/components/departmentAssign.js');
  const notes = read('js/components/notes.js');
  const auth = read('js/auth.js');

  assert.doesNotMatch(departments, /renderDeptNotes|dept-assign-notes/);
  assert.doesNotMatch(notes, /departmentNotes|scope === 'project'/);
  assert.match(jobDetail, /renderNotes\([^\n]+\{ canWrite: true \}\)/);
  assert.doesNotMatch(auth, /canAddProjectNotes/);
});
