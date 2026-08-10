// Renders a PDF's pages as stacked <canvas> elements inside a scrollable
// container, using PDF.js preloaded from a CDN during app startup. Mobile Safari's
// native PDF-in-iframe viewer only ever shows page 1 and won't scroll —
// that's a limitation of the OS-level PDF plugin, not something CSS can fix
// — so this renders pages ourselves instead, giving identical behavior on
// Mac browsers, iPad, and phone.
const PDFJS_VERSION = '4.7.76';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// Start the CDN request during normal app startup so opening the first PDF
// does not also have to wait for the viewer engine to download and parse.
export function preloadPdfViewer() {
  return loadPdfJs();
}

function yieldBeforeNextPage() {
  return new Promise(resolve => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(resolve, { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Render a PDF that PDF.js has already parsed. Exported separately so the
 * progressive rendering behavior can be verified without a network request.
 */
export async function renderLoadedPdfPages(pdf, container, isStale, onFirstPage = () => {}) {
  const width = container.clientWidth || 800;
  // An iPad's 2x screen makes each canvas four times as expensive to paint.
  // 1.5x remains sharp at fit-to-screen size while cutting that work nearly
  // in half; native pinch zoom still works when fine detail is needed.
  const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (isStale()) return;
    const page = await pdf.getPage(pageNum);
    const scale = width / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.className = 'proof-viewer-page';
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';

    const ctx = canvas.getContext('2d');
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
    await page.render({ canvasContext: ctx, viewport, transform }).promise;
    if (isStale()) return;
    container.appendChild(canvas);

    if (pageNum === 1) onFirstPage();
    if (pageNum < pdf.numPages) await yieldBeforeNextPage();
  }
}

/**
 * Renders every page of a PDF into `container`, one canvas per page, each
 * scaled to fit the container's width.
 * @param {HTMLElement} container
 * @param {Uint8Array} bytes
 * @param {() => boolean} isStale — checked between pages; rendering stops
 *   early once true (e.g. the viewer was closed, or reopened for a
 *   different job, before this finished).
 */
export async function renderPdfPages(container, bytes, isStale, onFirstPage = () => {}) {
  const pdfjsLib = await loadPdfJs();
  if (isStale()) return;

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  await renderLoadedPdfPages(pdf, container, isStale, onFirstPage);
}
