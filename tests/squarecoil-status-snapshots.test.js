const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Code.js'), 'utf8');

function loadBackend({ cacheValues = {}, lockAvailable = true } = {}) {
  const cache = { ...cacheValues };
  const properties = {
    SQUARECOIL_USERNAME: 'integration-user',
    SQUARECOIL_PASSWORD: 'do-not-log-this',
  };
  const context = vm.createContext({
    console, Date, JSON, Map, Set,
    CacheService: {
      getScriptCache: () => ({
        get: key => cache[key] || null,
        put: (key, value) => { cache[key] = value; },
        remove: key => { delete cache[key]; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => lockAvailable,
        waitLock() {},
        releaseLock() {},
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties[key] || null,
        setProperty: (key, value) => { properties[key] = value; },
      }),
    },
  });
  vm.runInContext(source, context);
  context.__cache = cache;
  return context;
}

test('browser status reads return the stored snapshot without contacting Squarecoil', () => {
  const snapshot = {
    jobs: [{ jobNum: '261423', title: 'Stored job', addr: '', squarecoilStatus: 'Graphics' }],
    unresolved: [],
    available: ['Graphics'],
    version: 7,
    refreshedAt: '2026-09-15T12:00:00.000Z',
  };
  const context = loadBackend({
    cacheValues: { squarecoil_status_snapshot_v1: JSON.stringify(snapshot) },
  });
  context.squarecoilLogin_ = () => { throw new Error('browser read contacted Squarecoil'); };

  const result = context.squarecoilProductionStatusJobs_();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), snapshot);
});

test('a scheduled refresh skips immediately when another refresh holds the lock', () => {
  const context = loadBackend({ lockAvailable: false });
  context.squarecoilFetchProductionStatusSnapshot_ = () => {
    throw new Error('contended refresh should not fetch');
  };

  const result = context.refreshSquarecoilStatusSnapshot_();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, skipped: true, reason: 'refresh_in_progress' });
});

test('a failed refresh retains the last valid snapshot', () => {
  const previous = {
    jobs: [{ jobNum: '261423', title: 'Last good job', addr: '', squarecoilStatus: 'Graphics' }],
    unresolved: [], available: ['Graphics'], version: 4, refreshedAt: '2026-09-15T11:00:00.000Z',
  };
  const context = loadBackend();
  let writes = 0;
  context.readSquarecoilStatusSnapshotStore_ = () => previous;
  context.writeSquarecoilStatusSnapshotStore_ = () => { writes++; };
  context.squarecoilFetchProductionStatusSnapshot_ = () => { throw new Error('Squarecoil unavailable'); };
  context.recordOperationalFailure = () => {};

  assert.throws(() => context.refreshSquarecoilStatusSnapshot_(), /Squarecoil unavailable/);
  assert.equal(writes, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(context.readSquarecoilStatusSnapshotStore_())), previous);
});

test('a successful refresh stores a compact version that only changes with snapshot content', () => {
  const previous = {
    jobs: [{ jobNum: '261423', title: 'Job', addr: '', squarecoilStatus: 'Graphics' }],
    unresolved: [], available: ['Graphics'], version: 9, refreshedAt: '2026-09-15T11:00:00.000Z',
  };
  const context = loadBackend();
  let stored;
  context.readSquarecoilStatusSnapshotStore_ = () => previous;
  context.writeSquarecoilStatusSnapshotStore_ = value => { stored = value; };
  context.squarecoilFetchProductionStatusSnapshot_ = () => ({
    jobs: previous.jobs,
    unresolved: [],
    available: ['Graphics'],
  });
  context.clearOperationalFailure = () => {};

  context.refreshSquarecoilStatusSnapshot_();
  assert.equal(stored.version, 9, 'an unchanged snapshot keeps its small version');

  context.squarecoilFetchProductionStatusSnapshot_ = () => ({
    jobs: [{ ...previous.jobs[0], squarecoilStatus: 'Manufacturing' }],
    unresolved: [],
    available: ['Graphics', 'Manufacturing'],
  });
  context.refreshSquarecoilStatusSnapshot_();
  assert.equal(stored.version, 10, 'changed snapshot increments its small version');
});

test('the manual refresh route queues background work instead of running it inline', () => {
  assert.match(source, /data\.action === 'refreshSquarecoilFilesNow'[\s\S]*queueSquarecoilRefresh_\(\)/);
  assert.doesNotMatch(source, /data\.action === 'refreshSquarecoilFilesNow'[\s\S]{0,500}refreshSquarecoilProductionFiles\(\)/);
});

test('the status trigger runs every five minutes independently of the PDF refresh', () => {
  assert.match(source, /newTrigger\('scheduledSquarecoilStatusRefresh'\)\.timeBased\(\)\.everyMinutes\(SQUARECOIL_STATUS_REFRESH_MINUTES\)/);
  assert.match(source, /newTrigger\('scheduledSquarecoilFileRefresh'\)\.timeBased\(\)\.everyHours\(SQUARECOIL_FILES_REFRESH_HOURS\)/);
});
