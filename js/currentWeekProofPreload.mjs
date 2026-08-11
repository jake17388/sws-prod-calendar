import { getCachedProofFile } from './proofCache.mjs';
import { deleteStoredProof, pruneStoredProofs, readStoredProof, storeProof } from './proofDiskCache.mjs';
import { validatePdfBytes } from './pdfViewer.js';

const inFlight = new Set();

export const productionProofCacheKey = jobNum => `production:${jobNum}`;

function formatLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function defaultFetchProof(jobNum) {
  const { fetchProofFile } = await import('./api.js');
  return fetchProofFile(jobNum);
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function selectProofJobsForWeek(jobs, weekOffset = 0, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + (weekOffset * 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const first = formatLocalISO(start);
  const last = formatLocalISO(end);
  const seen = new Set();
  return (jobs || []).filter(job => {
    const jobNum = String(job.jobNum || '');
    if (!jobNum || typeof job.dueDate !== 'string' || seen.has(jobNum) || job.dueDate < first || job.dueDate > last) return false;
    seen.add(jobNum);
    return true;
  });
}

export function selectCurrentWeekProofJobs(jobs, now = new Date()) {
  return selectProofJobsForWeek(jobs, 0, now);
}

export function isJobInPreloadedOriginalWindow(job, now = new Date()) {
  return selectProofJobsForWeek([job], 0, now).length === 1
    || selectProofJobsForWeek([job], 1, now).length === 1;
}

async function preloadProofTargets(targets, options, concurrency) {
  const readStored = options.readStored || readStoredProof;
  const fetchProof = options.fetchProof || defaultFetchProof;
  const writeStored = options.storeProof || storeProof;
  const removeStored = options.deleteStored || deleteStoredProof;
  const hasMemory = options.hasMemory || (key => !!getCachedProofFile(key));
  const validateProof = options.validateProof || (proof => validatePdfBytes(proof.bytes));
  const retryDelay = options.retryDelay || (attempt => new Promise(resolve => setTimeout(resolve, 350 * attempt)));
  const result = { total: targets.length, cached: 0, stored: 0, unavailable: 0, failed: 0 };
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const job = targets[nextIndex++];
      const key = productionProofCacheKey(job.jobNum);
      if (inFlight.has(key)) { result.cached++; continue; }
      inFlight.add(key);
      try {
        if (hasMemory(key)) {
          result.cached++;
          continue;
        }
        const stored = await readStored(key);
        if (stored) {
          if (await validateProof(stored)) {
            result.cached++;
            continue;
          }
          await removeStored(key);
        }

        let proof = null;
        let unavailable = false;
        let lastError = null;
        for (let attempt = 1; attempt <= 2 && !proof; attempt++) {
          try {
            const response = await fetchProof(job.jobNum);
            if (!response || !response.available || !response.base64) {
              unavailable = true;
              break;
            }
            const candidate = {
              name: response.name || `${job.jobNum}.pdf`,
              mimeType: 'application/pdf',
              bytes: base64ToBytes(response.base64),
            };
            if (await validateProof(candidate)) proof = candidate;
            else lastError = new Error('Invalid PDF data');
          } catch (err) {
            lastError = err;
          }
          if (!proof && attempt < 2) await retryDelay(attempt);
        }
        if (unavailable) {
          result.unavailable++;
          continue;
        }
        if (!proof) throw lastError || new Error('Could not validate PDF');
        const didStore = await writeStored(key, proof);
        if (didStore === false) result.failed++;
        else result.stored++;
      } catch (err) {
        result.failed++;
      } finally {
        inFlight.delete(key);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
  return result;
}

export async function preloadCurrentWeekProofs(jobs, options = {}) {
  if (!options.readStored && !options.storeProof) await pruneStoredProofs();
  const targets = selectCurrentWeekProofJobs(jobs, options.now || new Date());
  const concurrency = Math.max(1, Math.min(2, Number(options.concurrency) || 2));
  return preloadProofTargets(targets, options, concurrency);
}

export async function preloadCurrentAndNextWeekProofs(jobs, options = {}) {
  if (!options.readStored && !options.storeProof) await pruneStoredProofs();
  const now = options.now || new Date();
  const currentTargets = selectProofJobsForWeek(jobs, 0, now);
  const nextTargets = selectProofJobsForWeek(jobs, 1, now);
  const current = await preloadProofTargets(currentTargets, options, 2);
  const next = await preloadProofTargets(nextTargets, options, 1);
  return { current, next };
}
