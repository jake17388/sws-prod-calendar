import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { cleanUpdateUrl, updateReloadUrl } from '../js/updateUrl.mjs';

test('the update reload adds a cache buster without losing the current URL state', () => {
  assert.equal(
    updateReloadUrl('https://jake17388.github.io/sws-prod-calendar/?view=week#today', 1787855156616),
    'https://jake17388.github.io/sws-prod-calendar/?view=week&v=1787855156616#today',
  );
});

test('the loaded app removes only the temporary update cache buster from the visible URL', () => {
  assert.equal(
    cleanUpdateUrl('https://jake17388.github.io/sws-prod-calendar/?view=week&v=1787855156616#today'),
    'https://jake17388.github.io/sws-prod-calendar/?view=week#today',
  );
  assert.equal(
    cleanUpdateUrl('https://jake17388.github.io/sws-prod-calendar/#today'),
    'https://jake17388.github.io/sws-prod-calendar/#today',
  );
});

test('the application replaces the temporary update URL after its fresh script loads', () => {
  const app = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'js/app.js'), 'utf8');
  assert.match(app, /cleanUpdateUrl/);
  assert.match(app, /history\.replaceState/);
});
