import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('GitHub Pages publishes a curated frontend artifact', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /npm run build:pages/);
  assert.match(workflow, /path:\s*['"]?_site['"]?/);
  assert.doesNotMatch(workflow, /path:\s*['"]?\.['"]?/);
});

test('the Pages build includes runtime assets and excludes backend source and config', () => {
  const buildScript = fs.readFileSync(path.join(root, 'scripts/build-pages.mjs'), 'utf8');
  for (const asset of ['index.html', 'manifest.json', 'version.json', 'sw.js', 'js', 'styles', 'icons']) {
    assert.match(buildScript, new RegExp(`['"]${asset.replace('.', '\\.') }['"]`));
  }
  assert.doesNotMatch(buildScript, /Code\.js|appsscript\.json|\.clasp\.json/);
});

test('CI and both deployment workflows run checks and smoke tests on Node 24', () => {
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const pages = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  const backend = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  for (const workflow of [ci, pages, backend]) {
    assert.match(workflow, /node-version:\s*['"]24['"]/);
    assert.match(workflow, /npm run check/);
  }
  assert.match(pages, /Smoke test deployed frontend/);
  assert.match(backend, /Smoke test live backend/);
  assert.match(backend, /actions\/github-script@v8/);
});

test('a rollback runbook identifies the prior frontend and backend release procedures', () => {
  const runbook = fs.readFileSync(path.join(root, 'docs/ROLLBACK.md'), 'utf8');
  assert.match(runbook, /Apps Script/i);
  assert.match(runbook, /GitHub Pages/i);
  assert.match(runbook, /clasp deploy -i/);
});
