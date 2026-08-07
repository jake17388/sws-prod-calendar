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
});

test('managers can request session revocation without seeing a PIN', () => {
  const api = read('js/api.js');
  const users = read('js/components/userManagement.js');
  assert.match(api, /revokeUserSessions/);
  assert.match(users, /Revoke sessions/);
  assert.doesNotMatch(users, /user\.pin/);
});
