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

test('production files use the proven iPad write transport without showing global save state', () => {
  const api = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');

  assert.match(api, /fetchProofFile\s*=\s*jobNum\s*=>\s*scriptPost\(\{\s*action:\s*'getProofFile',\s*jobNum\s*\},\s*\{\s*tracksPendingWrite:\s*false\s*\}\)/);
  assert.doesNotMatch(api, /fetchProofFile\s*=\s*jobNum\s*=>\s*scriptGet/);
});

test('installed iPads use an opaque status bar and an unblurred safe-area-aware job panel', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const jobDetail = fs.readFileSync(path.join(root, 'styles/job-detail.css'), 'utf8');

  assert.match(html, /apple-mobile-web-app-status-bar-style" content="default"/);
  assert.match(
    jobDetail,
    /@media\s*\(min-width:\s*641px\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*#job-detail-overlay\s*\{[^}]*backdrop-filter:\s*none[^}]*-webkit-backdrop-filter:\s*none/,
  );
  assert.match(
    jobDetail,
    /@media\s*\(min-width:\s*641px\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*\.job-detail-header\s*\{[^}]*padding-top:\s*calc\(var\(--space-5\)\s*\+\s*env\(safe-area-inset-top\)\)/,
  );
});
