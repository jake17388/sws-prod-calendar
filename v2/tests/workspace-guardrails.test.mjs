import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findForbiddenProductionIdentifiers,
  validateV2Workspace,
} from '../shared/check-isolation.mjs';

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sws-v2-guardrails-'));
  for (const directory of [
    'v2/web',
    'v2/firestore/rules',
    'v2/firestore/indexes',
    'v2/firestore/seed',
    'v2/sync',
    'v2/shared',
    'v2/tests',
    'v2/docs',
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(
    path.join(root, 'v2/.env.example'),
    'V2_ENVIRONMENT=development\nFIREBASE_PROJECT_ID=replace-with-development-project-id\n',
  );
  return root;
}

test('accepts an isolated v2 workspace containing symbolic configuration', async () => {
  const root = await makeFixture();
  const result = await validateV2Workspace(root);
  assert.deepEqual(result.errors, []);
});

test('rejects a known production identifier anywhere under v2', async () => {
  const root = await makeFixture();
  await writeFile(path.join(root, 'v2/web/config.js'), 'const project = "prod-project-123";\n');

  const matches = await findForbiddenProductionIdentifiers(
    path.join(root, 'v2'),
    ['prod-project-123'],
  );

  assert.equal(matches.length, 1);
  assert.match(matches[0], /web\/config\.js/);
});

test('rejects production-like values in a development environment file', async () => {
  const root = await makeFixture();
  await writeFile(
    path.join(root, 'v2/.env.example'),
    'V2_ENVIRONMENT=development\nFIREBASE_PROJECT_ID=sws-production\n',
  );

  const result = await validateV2Workspace(root);
  assert.ok(result.errors.some((error) => error.includes('production-like')));
});
