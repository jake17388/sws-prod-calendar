import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DEPARTMENTS, JOB_DEPARTMENTS, JOB_TAGS } from '../js/config.js';

const desiredJobOrder = [
  'Manufacturing',
  'Graphics',
  'Routing',
  'Paint',
  'Letters',
  'Assembly',
  'Ship-In',
];

test('department selectors use the production workflow order', () => {
  assert.deepEqual(JOB_TAGS, desiredJobOrder);
  assert.deepEqual(JOB_DEPARTMENTS, desiredJobOrder.slice(0, -1));
  assert.deepEqual(DEPARTMENTS.slice(5), desiredJobOrder.slice(0, -1));
  assert.deepEqual(DEPARTMENTS.slice(0, 5), ['Admin', 'Manager', 'Viewer', 'Costing Viewer', 'TV']);
});

test('the backend mirrors the same production department order', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'Code.js'), 'utf8');
  assert.match(
    source,
    /const JOB_DEPARTMENTS = \['Manufacturing', 'Graphics', 'Routing', 'Paint', 'Letters', 'Assembly'\];/,
  );
});
