import assert from 'node:assert/strict';
import test from 'node:test';

test('current-week preloading selects Sunday through Saturday jobs once each', async () => {
  const { selectCurrentWeekProofJobs } = await import('../js/currentWeekProofPreload.mjs');
  const jobs = [
    { jobNum: 'sun', dueDate: '2026-08-09' },
    { jobNum: 'mon', dueDate: '2026-08-10' },
    { jobNum: 'sat', dueDate: '2026-08-15' },
    { jobNum: 'before', dueDate: '2026-08-08' },
    { jobNum: 'after', dueDate: '2026-08-16' },
    { jobNum: 'mon', dueDate: '2026-08-10' },
    { dueDate: '2026-08-12' },
  ];

  assert.deepEqual(
    selectCurrentWeekProofJobs(jobs, new Date(2026, 7, 10)).map(job => job.jobNum),
    ['sun', 'mon', 'sat'],
  );
});

test('preloading fetches only uncached files with at most two background requests', async () => {
  const { preloadCurrentWeekProofs } = await import('../js/currentWeekProofPreload.mjs');
  const fetched = [];
  const stored = [];
  let active = 0;
  let maxActive = 0;
  const jobs = ['260001', '260002', '260003'].map((jobNum, index) => ({
    jobNum,
    dueDate: `2026-08-${String(10 + index).padStart(2, '0')}`,
  }));

  const result = await preloadCurrentWeekProofs(jobs, {
    now: new Date(2026, 7, 10),
    concurrency: 2,
    readStored: async key => key.endsWith('260001') ? { bytes: new Uint8Array([1]) } : null,
    fetchProof: async jobNum => {
      fetched.push(jobNum);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { available: true, name: `${jobNum}.pdf`, base64: 'AQID' };
    },
    storeProof: async (key, proof) => stored.push([key, Array.from(proof.bytes)]),
  });

  assert.deepEqual(fetched.sort(), ['260002', '260003']);
  assert.equal(maxActive, 2);
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0][1], [1, 2, 3]);
  assert.deepEqual(result, { total: 3, cached: 1, stored: 2, unavailable: 0, failed: 0 });
});

test('one missing or failed proof does not stop the rest of the week', async () => {
  const { preloadCurrentWeekProofs } = await import('../js/currentWeekProofPreload.mjs');
  const jobs = ['missing', 'failed', 'ready'].map((jobNum, index) => ({
    jobNum,
    dueDate: `2026-08-${String(10 + index).padStart(2, '0')}`,
  }));
  const stored = [];

  const result = await preloadCurrentWeekProofs(jobs, {
    now: new Date(2026, 7, 10),
    readStored: async () => null,
    fetchProof: async jobNum => {
      if (jobNum === 'failed') throw new Error('offline');
      if (jobNum === 'missing') return { available: false };
      return { available: true, name: 'ready.pdf', base64: 'AQ==' };
    },
    storeProof: async key => stored.push(key),
  });

  assert.deepEqual(stored, ['production:ready']);
  assert.deepEqual(result, { total: 3, cached: 0, stored: 1, unavailable: 1, failed: 1 });
});

test('prefetched bytes are stored on disk with expiration metadata', async () => {
  const { readStoredProof, storeProof } = await import('../js/proofDiskCache.mjs');
  const responses = new Map();
  const cache = {
    put: async (request, response) => responses.set(request.url, response.clone()),
    match: async request => responses.get(request.url)?.clone() || null,
    delete: async request => responses.delete(request.url),
  };
  const cacheStorage = { open: async () => cache };
  const proof = { name: '260001.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([4, 5, 6]) };

  await storeProof('production:260001', proof, 1000, cacheStorage);
  const stored = await readStoredProof('production:260001', 1001, cacheStorage);
  assert.equal(stored.name, proof.name);
  assert.equal(stored.mimeType, proof.mimeType);
  assert.deepEqual(Array.from(stored.bytes), [4, 5, 6]);
});
