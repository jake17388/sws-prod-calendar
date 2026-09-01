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

test('Display exposes a dark theme preference applied at startup and on change', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const tokens = read('styles/tokens.css');
  assert.match(html, /id="theme-select"/);
  assert.match(html, /Dark/);
  assert.match(app, /THEME_KEY\s*=\s*['"]sws_prod_cal_theme['"]/);
  assert.match(app, /data-theme/);
  assert.match(app, /theme-select.*addEventListener|addEventListener\(['"]change['"][\s\S]*theme-select/);
  assert.match(tokens, /\[data-theme="dark"\]/);
});

test('Settings exposes Squarecoil status and refresh without Dropbox credentials', () => {
  const html = read('index.html');
  const component = read('js/components/squarecoilSettings.js');
  const api = read('js/api.js');
  assert.match(html, /id="squarecoil-settings-section"/);
  assert.match(html, /Squarecoil Integration/);
  assert.match(html, /id="squarecoil-refresh-btn"/);
  assert.match(component, /refreshSquarecoilSettingsUI/);
  assert.match(component, /refreshSquarecoilFilesNow/);
  assert.match(api, /fetchSquarecoilStatus/);
  assert.doesNotMatch(html + component + api, /Dropbox Integration|DROPBOX_APP_KEY|dropbox-app-secret|fetchDropboxAuthUrl/);
});

test('My Account only lets Admins edit names while every role can edit its PIN', () => {
  const app = read('js/app.js');
  const users = read('js/components/userManagement.js');
  assert.match(app, /my-account-name'[\s\S]*readOnly\s*=\s*!isAdmin\(\)/);
  assert.match(app, /isAdmin\(\)[\s\S]*name/);
  assert.match(users, /actorDept === 'Admin'[\s\S]*user-row-name/);
});
