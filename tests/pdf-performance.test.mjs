import assert from 'node:assert/strict';
import test from 'node:test';

test('the PDF renderer reveals page one before starting later pages and caps iPad render density', async () => {
  const { renderLoadedPdfPages } = await import('../js/pdfViewer.js');
  assert.equal(typeof renderLoadedPdfPages, 'function');

  const events = [];
  const canvases = [];
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 3 };
  globalThis.document = {
    createElement: () => {
      const canvas = { style: {}, getContext: () => ({}) };
      canvases.push(canvas);
      return canvas;
    },
  };

  const pdf = {
    numPages: 2,
    getPage: async pageNum => {
      events.push(`get-${pageNum}`);
      return {
        getViewport: ({ scale }) => ({ width: 400 * scale, height: 600 * scale }),
        render: () => ({ promise: Promise.resolve() }),
      };
    },
  };
  const container = {
    clientWidth: 800,
    appendChild: () => events.push(`append-${canvases.length}`),
  };

  try {
    await renderLoadedPdfPages(pdf, container, () => false, () => events.push('first-page'));
    assert.ok(events.indexOf('first-page') < events.indexOf('get-2'));
    assert.equal(canvases[0].width, 1200);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('recent production files remain in a bounded in-memory cache for instant reopening', async () => {
  const {
    cacheProofFile,
    clearProofFileCache,
    getCachedProofFile,
    PROOF_CACHE_TTL_MS,
  } = await import('../js/proofCache.mjs');

  clearProofFileCache();
  const proof = { name: 'job.pdf', bytes: new Uint8Array([1, 2, 3]) };
  cacheProofFile('260001', proof, 1000);
  assert.equal(getCachedProofFile('260001', 1001), proof);
  assert.equal(getCachedProofFile('260001', 1000 + PROOF_CACHE_TTL_MS + 1), null);

  for (let i = 1; i <= 4; i++) cacheProofFile(`job-${i}`, proof, 2000 + i);
  assert.equal(getCachedProofFile('job-1', 3000), null);
  assert.equal(getCachedProofFile('job-4', 3000), proof);
});

test('the app starts loading the PDF engine before a user opens a file', async () => {
  const pdfViewer = await import('../js/pdfViewer.js');
  assert.equal(typeof pdfViewer.preloadPdfViewer, 'function');

  const appSource = await import('node:fs/promises')
    .then(fs => fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8'));
  assert.match(appSource, /preloadPdfViewer\(\)/);
});
