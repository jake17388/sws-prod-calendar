import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Settings uses a wide organized desktop grid', () => {
  const html = read('index.html');
  const css = read('styles/layout.css');
  assert.match(html, /class="settings-shell"/);
  assert.match(html, /class="settings-grid"/);
  assert.match(html, /class="settings-card/);
  assert.match(css, /\.settings-shell[\s\S]*max-width:\s*1400px/);
  assert.match(css, /\.settings-grid[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('text size spans 50 through 200 percent', () => {
  const app = read('js/app.js');
  assert.match(app, /ZOOM_STEPS\s*=\s*\[50,[^\]]*200\]/);
});

test('Dropbox debug controls are removed and proof refresh comes first', () => {
  const html = read('index.html');
  const component = read('js/components/dropboxSettings.js');
  const api = read('js/api.js');
  assert.doesNotMatch(html, /dropbox-debug|Debug proof lookup/);
  assert.doesNotMatch(component, /debugDropboxProof|handleDebug|dropbox-debug/);
  assert.doesNotMatch(api, /debugDropboxProof/);
  assert.ok(html.indexOf('dropbox-refresh-btn') < html.indexOf('dropbox-credentials-fields'));
});

test('My Account only lets Admins edit names while every role can edit its PIN', () => {
  const app = read('js/app.js');
  const users = read('js/components/userManagement.js');
  assert.match(app, /my-account-name'[\s\S]*readOnly\s*=\s*!isAdmin\(\)/);
  assert.match(app, /isAdmin\(\)[\s\S]*name/);
  assert.match(users, /actorDept === 'Admin'[\s\S]*user-row-name/);
});
