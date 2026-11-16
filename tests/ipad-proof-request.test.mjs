import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildScriptGetRequest } from '../js/scriptRequest.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('production-file requests bypass stale iPad caches with a unique no-store GET', () => {
  const first = buildScriptGetRequest(
    'https://script.google.com/macros/s/example/exec',
    'getProofFile',
    'session-token',
    { jobNum: '261169' },
    { cacheBust: true, nonce: 1001 },
  );
  const second = buildScriptGetRequest(
    'https://script.google.com/macros/s/example/exec',
    'getProofFile',
    'session-token',
    { jobNum: '261169' },
    { cacheBust: true, nonce: 1002 },
  );

  assert.equal(first.options.cache, 'no-store');
  assert.equal(new URL(first.url).searchParams.get('jobNum'), '261169');
  assert.equal(new URL(first.url).searchParams.get('_'), '1001');
  assert.notEqual(first.url, second.url);
});

test('the freshness service worker leaves cross-origin Apps Script responses alone', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  assert.match(serviceWorker, /url\.origin\s*!==\s*self\.location\.origin/);
  assert.match(serviceWorker, /return/);
});
