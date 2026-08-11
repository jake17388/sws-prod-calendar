import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the installed app fills the complete dynamic viewport on iPhone and iPad', () => {
  const css = read('styles/layout.css');

  assert.doesNotMatch(css, /height:\s*-webkit-fill-available/);
  assert.match(css, /body\s*\{[^}]*height:\s*100dvh/s);
  assert.match(css, /#app\s*\{[^}]*height:\s*100dvh/s);
  assert.match(css, /#pin-screen\s*\{[^}]*height:\s*100dvh/s);
});
