import assert from 'node:assert/strict';
import test from 'node:test';

test('the PDF renderer re-renders from source resolution when zooming', async () => {
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
    await renderLoadedPdfPages(pdf, container, () => false, () => events.push('first-page'), { zoom: 2, lazy: false });
    assert.ok(events.indexOf('first-page') < events.indexOf('get-2'));
    assert.equal(canvases[0].width, 3200);
    assert.equal(canvases[0].style.width, '1600px');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('PDF validation rejects error pages and accepts PDF signatures', async () => {
  const { looksLikePdfBytes } = await import('../js/pdfViewer.js');
  assert.equal(looksLikePdfBytes(new TextEncoder().encode('%PDF-1.7\n')), true);
  assert.equal(looksLikePdfBytes(new TextEncoder().encode('<html>temporary error</html>')), false);
  assert.equal(looksLikePdfBytes(new Uint8Array()), false);
});

test('the PDF engine is self-hosted and the viewer exposes zoom and original-file controls', async () => {
  const fs = await import('node:fs/promises');
  const viewerSource = await fs.readFile(new URL('../js/pdfViewer.js', import.meta.url), 'utf8');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const buildSource = await fs.readFile(new URL('../scripts/build-pages.mjs', import.meta.url), 'utf8');

  assert.match(viewerSource, /vendor\/pdfjs\/pdf\.min\.mjs/);
  assert.doesNotMatch(viewerSource, /cdn\.jsdelivr\.net/);
  assert.match(viewerSource, /IntersectionObserver/);
  assert.match(html, /id="proof-viewer-zoom-in"/);
  assert.match(html, /id="proof-viewer-open-original"/);
  assert.match(buildSource, /'vendor'/);
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

test('additional project PDFs use the same instant-reopen cache', async () => {
  const componentSource = await import('node:fs/promises')
    .then(fs => fs.readFile(new URL('../js/components/jobDetail.js', import.meta.url), 'utf8'));
  assert.match(componentSource, /additional:\$\{job\.jobKey\}:\$\{file\.id\}/);
  assert.match(componentSource, /getCachedProofFile\(cacheKey\)/);
});

test('bad cached files can be evicted before a clean retry', async () => {
  const { cacheProofFile, deleteCachedProofFile, getCachedProofFile } = await import('../js/proofCache.mjs');
  const { deleteStoredProof, readStoredProof, storeProof } = await import('../js/proofDiskCache.mjs');
  const memoryProof = { name: 'bad.pdf', bytes: new Uint8Array([1]) };
  cacheProofFile('repair-me', memoryProof, 1000);
  assert.equal(deleteCachedProofFile('repair-me'), true);
  assert.equal(getCachedProofFile('repair-me', 1001), null);

  const responses = new Map();
  const cache = {
    put: async (request, response) => responses.set(request.url, response.clone()),
    match: async request => responses.get(request.url)?.clone() || null,
    delete: async request => responses.delete(request.url),
  };
  const cacheStorage = { open: async () => cache };
  await storeProof('repair-me', memoryProof, 1000, cacheStorage);
  assert.equal(await deleteStoredProof('repair-me', cacheStorage), true);
  assert.equal(await readStoredProof('repair-me', 1001, cacheStorage), null);
});
