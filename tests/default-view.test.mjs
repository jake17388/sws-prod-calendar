import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Settings offers a personal default view and the app defaults to Schedule', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  assert.match(html, /id="default-view-select"/);
  assert.match(html, /value="schedule"[^>]*>Schedule</);
  assert.match(html, /value="jobSelector"[^>]*>Job Selector</);
  assert.match(app, /DEFAULT_VIEW_KEY/);
  assert.match(app, /activeView\s*=\s*getDefaultView\(\)/);
  assert.match(app, /const DEFAULT_VIEW\s*=\s*'schedule'/);
});

test('TV displays remain locked to the Week view', () => {
  const app = read('js/app.js');
  assert.match(app, /if\s*\(isTvDisplay\(\)\)\s*activeView\s*=\s*'week'/);
});
