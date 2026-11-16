import assert from 'node:assert/strict';
import test from 'node:test';

import { ensurePromiseWithResolvers } from '../js/pdfViewer.js';

test('the PDF viewer restores Promise.withResolvers for older iPad Safari', async () => {
  const promiseConstructor = {
    resolve: Promise.resolve.bind(Promise),
  };

  ensurePromiseWithResolvers(promiseConstructor);

  assert.equal(typeof promiseConstructor.withResolvers, 'function');
  const { promise, resolve, reject } = promiseConstructor.withResolvers();
  assert.equal(typeof resolve, 'function');
  assert.equal(typeof reject, 'function');
  resolve('ready');
  assert.equal(await promise, 'ready');
});

test('the compatibility setup preserves a native Promise.withResolvers', () => {
  const native = () => ({ promise: 'native' });
  const promiseConstructor = { withResolvers: native };

  ensurePromiseWithResolvers(promiseConstructor);

  assert.equal(promiseConstructor.withResolvers, native);
});
