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

export function selectCurrentWeekProofJobs(jobs, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
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

export async function preloadCurrentWeekProofs(jobs, options = {}) {
  const targets = selectCurrentWeekProofJobs(jobs, options.now || new Date());
  const readStored = options.readStored || readStoredProof;
  const fetchProof = options.fetchProof || defaultFetchProof;
  const writeStored = options.storeProof || storeProof;
  const hasMemory = options.hasMemory || (key => !!getCachedProofFile(key));
  const concurrency = Math.max(1, Math.min(2, Number(options.concurrency) || 2));
  const result = { total: targets.length, cached: 0, stored: 0, unavailable: 0, failed: 0 };
  let nextIndex = 0;

  if (!options.readStored && !options.storeProof) await pruneStoredProofs();

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
        await writeStored(key, proof);
        result.stored++;
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
