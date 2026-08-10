const USER_COUNT = 30;
const REQUESTS_PER_USER = 3;
const targetUrl = process.env.SWS_LOAD_TEST_URL || '';
const token = process.env.SWS_LOAD_TEST_TOKEN || '';

async function request(userIndex, round) {
  if (!targetUrl || !token) {
    await new Promise(resolve => setTimeout(resolve, 5 + ((userIndex * 7 + round * 11) % 20)));
    return { ok: true, simulated: true };
  }
  const url = new URL(targetUrl);
  url.searchParams.set('action', 'getTrackingVersion');
  url.searchParams.set('token', token);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error);
  return { ok: true, simulated: false };
}

const startedAt = Date.now();
const results = await Promise.allSettled(
  Array.from({ length: USER_COUNT }, (_, userIndex) =>
    (async () => {
      for (let round = 0; round < REQUESTS_PER_USER; round++) await request(userIndex, round);
    })(),
  ),
);
const failures = results.filter(result => result.status === 'rejected');
const elapsedMs = Date.now() - startedAt;
const mode = targetUrl && token ? 'live read-only' : 'local simulation';
console.log(`${mode}: ${USER_COUNT} users × ${REQUESTS_PER_USER} requests in ${elapsedMs}ms; ${failures.length} failed`);
if (failures.length) {
  failures.slice(0, 5).forEach(result => console.error(result.reason && result.reason.message));
  process.exitCode = 1;
}
