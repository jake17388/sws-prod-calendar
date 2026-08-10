import { getCachedProofFile } from './proofCache.mjs';
import { pruneStoredProofs, readStoredProof, storeProof } from './proofDiskCache.mjs';

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

async function preloadProofTargets(targets, options, concurrency) {
  const readStored = options.readStored || readStoredProof;
  const fetchProof = options.fetchProof || defaultFetchProof;
  const writeStored = options.storeProof || storeProof;
  const hasMemory = options.hasMemory || (key => !!getCachedProofFile(key));
  const result = { total: targets.length, cached: 0, stored: 0, unavailable: 0, failed: 0 };
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const job = targets[nextIndex++];
      const key = productionProofCacheKey(job.jobNum);
      if (inFlight.has(key)) { result.cached++; continue; }
      inFlight.add(key);
      try {
        if (hasMemory(key) || await readStored(key)) {
          result.cached++;
          continue;
        }
        const response = await fetchProof(job.jobNum);
        if (!response || !response.available || !response.base64) {
          result.unavailable++;
          continue;
        }
        const proof = {
          name: response.name || `${job.jobNum}.pdf`,
          mimeType: 'application/pdf',
          bytes: base64ToBytes(response.base64),
        };
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
