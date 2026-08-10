// PDF.js is installed as a pinned build dependency and copied into the Pages
// artifact. Keeping the engine beside the app removes a third-party CDN and
// worker request from the critical path when a production file is opened.
const PDFJS_MODULE = '../vendor/pdfjs/pdf.min.mjs';
const PDFJS_WORKER = '../vendor/pdfjs/pdf.worker.min.mjs';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(PDFJS_MODULE).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, import.meta.url).href;
      return lib;
    }).catch(err => {
      pdfjsLibPromise = null;
      throw err;
    });
  }
  return pdfjsLibPromise;
}

export function resetPdfViewerEngine() {
  pdfjsLibPromise = null;
}

// Keeps browser code independent from test tooling while allowing the complete
// parse/render/zoom lifecycle to be exercised without loading a worker in Node.
export function setPdfJsForTests(lib) {
  pdfjsLibPromise = Promise.resolve(lib);
}

export function preloadPdfViewer() {
  return loadPdfJs();
}

export function looksLikePdfBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) return false;
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

// Parse a copy because PDF.js may transfer the supplied ArrayBuffer to its
// worker. The original bytes must remain intact for CacheStorage and reopening.
export async function validatePdfBytes(bytes) {
  if (!looksLikePdfBytes(bytes)) return false;
  let pdf = null;
  try {
    const lib = await loadPdfJs();
    pdf = await lib.getDocument({ data: bytes.slice() }).promise;
    return pdf.numPages > 0;
  } catch (err) {
    return false;
  } finally {
    if (pdf) await pdf.destroy().catch(() => {});
  }
}

function yieldBeforeNextPage() {
  return new Promise(resolve => {
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(resolve, { timeout: 50 });
    else setTimeout(resolve, 0);
  });
}

async function renderPage(page, width, zoom, outputScale, isStale) {
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width / unscaled.width) * zoom });
  const canvas = document.createElement('canvas');
  canvas.className = 'proof-viewer-page';
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform }).promise;
  return isStale() ? null : canvas;
}

/**
 * Renders page one immediately. In browsers, later pages are represented by
 * correctly sized placeholders and rendered only as they approach the visible
 * scroll area. Zooming calls this again from the original vector PDF.
 */
export async function renderLoadedPdfPages(pdf, container, isStale, onFirstPage = () => {}, options = {}) {
  const width = container.clientWidth || 800;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(options.zoom) || 1));
  // Full Retina density at fit-to-width, with additional detail supplied by
  // the zoom scale. This avoids the old 1.5x bitmap ceiling without attempting
  // 3x/4x canvases that frequently exceed iPad memory limits.
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const lazy = options.lazy !== false && typeof globalThis.IntersectionObserver === 'function';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (isStale()) return;
    const page = await pdf.getPage(pageNum);
    if (pageNum === 1 || !lazy) {
      const canvas = await renderPage(page, width, zoom, outputScale, isStale);
      if (!canvas) return;
      container.appendChild(canvas);
      if (pageNum === 1) onFirstPage();
      if (pageNum < pdf.numPages) await yieldBeforeNextPage();
      continue;
    }

    const base = page.getViewport({ scale: 1 });
    const displayScale = (width / base.width) * zoom;
    const placeholder = document.createElement('div');
    placeholder.className = 'proof-viewer-page-placeholder';
    placeholder.style.width = `${Math.floor(base.width * displayScale)}px`;
    placeholder.style.height = `${Math.floor(base.height * displayScale)}px`;
    container.appendChild(placeholder);

    const observer = new IntersectionObserver(async entries => {
      if (!entries.some(entry => entry.isIntersecting) || isStale()) return;
      observer.disconnect();
      try {
        const canvas = await renderPage(page, width, zoom, outputScale, isStale);
        if (canvas && placeholder.isConnected) placeholder.replaceWith(canvas);
      } catch (err) {
        placeholder.classList.add('failed');
        placeholder.textContent = 'Page failed to render';
      }
    }, { root: container, rootMargin: '800px 0px' });
    observer.observe(placeholder);
  }
}

export async function renderPdfPages(container, bytes, isStale, onFirstPage = () => {}) {
  if (!looksLikePdfBytes(bytes)) throw new Error('Invalid PDF bytes');
  const lib = await loadPdfJs();
  if (isStale()) return null;
  const pdf = await lib.getDocument({ data: bytes.slice() }).promise;
  let zoom = 1;
  let generation = 0;

  const render = async () => {
    const ownGeneration = ++generation;
    container.replaceChildren();
    await renderLoadedPdfPages(
      pdf,
      container,
      () => isStale() || ownGeneration !== generation,
      onFirstPage,
      { zoom },
    );
  };

  try {
    await render();
  } catch (err) {
    generation++;
    await pdf.destroy().catch(() => {});
    throw err;
  }
  return {
    get zoom() { return zoom; },
    async setZoom(nextZoom) {
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextZoom) || 1));
      await render();
      return zoom;
    },
    async destroy() {
      generation++;
      await pdf.destroy().catch(() => {});
    },
  };
}
