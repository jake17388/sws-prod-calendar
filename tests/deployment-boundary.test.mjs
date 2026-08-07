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
