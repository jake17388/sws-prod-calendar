import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('management tools use full-width Settings subpages instead of side panels', () => {
  const html = read('index.html');
  const userCss = read('styles/user-mgmt.css');
  const taskCss = read('styles/common-tasks.css');

  assert.match(html, /id="user-mgmt-overlay" class="settings-subpage"/);
  assert.match(html, /id="common-task-overlay" class="settings-subpage"/);
  assert.match(html, /class="user-mgmt-panel settings-subpage-shell"/);
  assert.match(html, /class="common-task-panel settings-subpage-shell"/);
  assert.match(userCss, /\.user-mgmt-panel[\s\S]*max-width:\s*1400px/);
  assert.match(taskCss, /\.common-task-panel[\s\S]*max-width:\s*1400px/);
  assert.doesNotMatch(userCss, /translate[XY]\(|#user-mgmt-overlay\s*\{[^}]*justify-content:\s*flex-end/);
  assert.doesNotMatch(taskCss, /#common-task-overlay\s*\{[^}]*justify-content:\s*flex-end/);
});

test('management subpages provide a clear route back to Settings', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const users = read('js/components/userManagement.js');
  const tasks = read('js/components/commonTaskManagement.js');

  assert.match(html, /id="user-mgmt-back"[^>]*>[\s\S]*Settings<\/button>/);
  assert.match(html, /id="common-task-back"[^>]*>[\s\S]*Settings<\/button>/);
  assert.match(app, /addEventListener\('open-settings',\s*openSettings\)/);
  assert.match(users, /new CustomEvent\('open-settings'\)/);
  assert.match(tasks, /new CustomEvent\('open-settings'\)/);
});

test('mobile management back buttons sit below the iPhone safe area', () => {
  const userCss = read('styles/user-mgmt.css');
  const taskCss = read('styles/common-tasks.css');

  assert.match(userCss, /@media \(max-width: 640px\)[\s\S]*\.user-mgmt-panel\s*\{[^}]*padding:\s*calc\(var\(--space-5\) \+ env\(safe-area-inset-top\)\)/);
  assert.match(taskCss, /@media \(max-width: 640px\)[\s\S]*\.common-task-panel\s*\{[^}]*padding:\s*calc\(var\(--space-5\) \+ env\(safe-area-inset-top\)\)/);
});
