const CACHE_NAME = 'sws-production-files-v1';
export const STORED_PROOF_TTL_MS = 6 * 60 * 60 * 1000;

function cacheRequest(key) {
  return new Request(`https://sws-proof-cache.invalid/${encodeURIComponent(String(key))}`);
}

function decodeHeader(value, fallback = '') {
  try { return decodeURIComponent(value || ''); } catch (err) { return fallback; }
}

export async function storeProof(key, proof, now = Date.now(), cacheStorage = globalThis.caches) {
  if (!cacheStorage || !proof || !proof.bytes) return false;
  try {
    const cache = await cacheStorage.open(CACHE_NAME);
    const response = new Response(proof.bytes, {
      headers: {
        'Content-Type': proof.mimeType || 'application/pdf',
        'X-SWS-Cached-At': String(now),
        'X-SWS-File-Name': encodeURIComponent(proof.name || 'Production File.pdf'),
      },
    });
    await cache.put(cacheRequest(key), response);
    return true;
  } catch (err) {
    // Cache Storage can be unavailable in private browsing or under device
    // storage pressure. Preloading is an optimization, never a requirement.
    return false;
  }
}

export async function readStoredProof(key, now = Date.now(), cacheStorage = globalThis.caches) {
  if (!cacheStorage) return null;
  try {
    const cache = await cacheStorage.open(CACHE_NAME);
    const request = cacheRequest(key);
    const response = await cache.match(request);
    if (!response) return null;
    const cachedAt = Number(response.headers.get('X-SWS-Cached-At')) || 0;
    if (!cachedAt || now - cachedAt > STORED_PROOF_TTL_MS) {
      await cache.delete(request);
      return null;
    }
    return {
      name: decodeHeader(response.headers.get('X-SWS-File-Name'), 'Production File.pdf'),
      mimeType: response.headers.get('Content-Type') || 'application/pdf',
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (err) {
    return null;
  }
}

export async function deleteStoredProof(key, cacheStorage = globalThis.caches) {
  if (!cacheStorage) return false;
  try {
    const cache = await cacheStorage.open(CACHE_NAME);
    return cache.delete(cacheRequest(key));
  } catch (err) {
    return false;
  }
}

export async function pruneStoredProofs(now = Date.now(), cacheStorage = globalThis.caches) {
  if (!cacheStorage) return 0;
  try {
    const cache = await cacheStorage.open(CACHE_NAME);
    const requests = await cache.keys();
    let removed = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      const cachedAt = response ? Number(response.headers.get('X-SWS-Cached-At')) || 0 : 0;
      if (!cachedAt || now - cachedAt > STORED_PROOF_TTL_MS) {
        if (await cache.delete(request)) removed++;
      }
    }
    return removed;
  } catch (err) {
    return 0;
  }
}
