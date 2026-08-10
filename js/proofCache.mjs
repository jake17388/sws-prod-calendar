const MAX_CACHED_PROOFS = 3;
export const PROOF_CACHE_TTL_MS = 10 * 60 * 1000;

const proofFiles = new Map();

export function cacheProofFile(jobNum, proof, now = Date.now()) {
  const key = String(jobNum);
  proofFiles.delete(key);
  proofFiles.set(key, { proof, cachedAt: now });
  while (proofFiles.size > MAX_CACHED_PROOFS) {
    proofFiles.delete(proofFiles.keys().next().value);
  }
}

export function getCachedProofFile(jobNum, now = Date.now()) {
  const key = String(jobNum);
  const entry = proofFiles.get(key);
  if (!entry) return null;
  if (now - entry.cachedAt > PROOF_CACHE_TTL_MS) {
    proofFiles.delete(key);
    return null;
  }
  // Reading a file makes it the most recently used cache entry.
  proofFiles.delete(key);
  proofFiles.set(key, entry);
  return entry.proof;
}

export function clearProofFileCache() {
  proofFiles.clear();
}
