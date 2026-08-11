import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the installed app works around WebKit excluding the safe area from dynamic viewport units', () => {
  const css = read('styles/layout.css');

  assert.doesNotMatch(css, /height:\s*-webkit-fill-available/);
  assert.match(css, /body\s*\{[^}]*height:\s*100dvh/s);
  assert.match(css, /#app\s*\{[^}]*height:\s*100dvh/s);
  assert.match(css, /#pin-screen\s*\{[^}]*height:\s*100dvh/s);
  assert.match(
    css,
    /@media[^\{]*\(display-mode:\s*standalone\)[\s\S]*html,\s*body,\s*#app,\s*#pin-screen\s*\{[^}]*height:\s*100vh/,
  );
});
