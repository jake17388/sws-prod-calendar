import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the UI treats PINs as write-only six-digit credentials', () => {
  const api = read('js/api.js');
  const app = read('js/app.js');
  const users = read('js/components/userManagement.js');
  const html = read('index.html');

  assert.doesNotMatch(api, /getMyPin|fetchMyPin/);
  assert.doesNotMatch(app, /fetchMyPin/);
  assert.match(users, /\^\\d\{6\}\$/);
  assert.match(html, /maxlength="6"/);
  assert.match(html, /6-digit PIN/);
  assert.doesNotMatch(html, /Existing 4-digit PINs/);
  assert.doesNotMatch(read('js/auth.js'), /legacySubmitTimer/);
});

test('user management reveals PINs to Admins and puts session revocation in a user dialog', () => {
  const api = read('js/api.js');
  const users = read('js/components/userManagement.js');
  const html = read('index.html');
  assert.match(api, /revokeUserSessions/);
  assert.doesNotMatch(users, /class="user-row-revoke"/);
  assert.match(users, /openUserActions/);
  assert.match(html, /id="user-actions-dialog"/);
  assert.match(html, /Revoke all sessions/);
  assert.match(users, /currentDepartment\(\) === 'Admin'/);
  assert.match(users, /user\.pin/);
});

test('My Account submits a PIN from the keyboard and preserves the replacement session token', () => {
  const app = read('js/app.js');
  assert.match(app, /my-account-pin'[\s\S]*keydown[\s\S]*saveMyAccount/);
  assert.match(app, /updateAuthProfile\(\{ user: res\.user\.name,[\s\S]*token: res\.token/);
});

test('the PIN pad uses immediate pointer input and the app theme', () => {
  const auth = read('js/auth.js');
  const css = read('styles/layout.css');

  assert.match(auth, /addEventListener\('pointerdown'/);
  assert.match(auth, /pointerType === 'touch'/);
  assert.match(css, /\.pin-card\s*\{[^}]*--color-brand-navy/s);
  assert.match(css, /\.pin-pad button:active\s*\{[^}]*--color-brand-gold/s);
  assert.match(css, /\.pin-pad button\s*\{[^}]*touch-action:\s*none/s);
});
