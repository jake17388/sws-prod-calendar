const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackend(initialProperties = {}) {
  const values = { ...initialProperties };
  const cacheValues = new Map();
  let uuid = 0;
  const properties = {
    getProperty: key => values[key] ?? null,
    setProperty: (key, value) => { values[key] = value; },
    deleteProperty: key => { delete values[key]; },
  };
  const cache = {
    get: key => cacheValues.get(key) ?? null,
    put: (key, value) => cacheValues.set(key, value),
    remove: key => cacheValues.delete(key),
  };
  const toBuffer = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Map,
    Set,
    PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      computeHmacSha256Signature: (value, key) => crypto.createHmac('sha256', key).update(value).digest(),
      base64EncodeWebSafe: value => toBuffer(value).toString('base64url'),
      base64DecodeWebSafe: value => Buffer.from(value, 'base64url'),
      newBlob: value => ({ getDataAsString: () => toBuffer(value).toString() }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8'), context);
  return { context, values };
}

test('new PINs require six digits while existing four-digit PINs migrate without locking users out', () => {
  const original = [{ id: 'u1', name: 'Pat', department: 'Paint', pin: '1234' }];
  const { context, values } = loadBackend({ USERS: JSON.stringify(original) });

  assert.equal(context.validPin('123456'), true);
  assert.equal(context.validPin('1234'), false);
  const users = context.getUsers();
  assert.equal(users[0].pin, undefined);
  assert.equal(typeof users[0].pinHash, 'string');
  assert.equal(JSON.parse(values.USERS)[0].pin, undefined);
  assert.equal(context.checkPin('1234', 'ipad-1').ok, true);
});

test('public user records never expose credential material', () => {
  const { context } = loadBackend();
  const publicRecord = context.publicUser({
    id: 'u1', name: 'Pat', department: 'Paint', pin: '123456', adminPin: '123456', pinHash: 'hash', pinSalt: 'salt', authVersion: 2,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(publicRecord)), {
    id: 'u1', name: 'Pat', department: 'Paint', authVersion: 2,
  });
});

test('only Admins receive recoverable PINs in user management', () => {
  const { context } = loadBackend();
  const user = { id: 'u1', name: 'Pat', department: 'Paint', adminPin: '123456', pinHash: 'hash', pinSalt: 'salt', authVersion: 1 };
  assert.equal(context.userFor({ department: 'Admin' }, user).pin, '123456');
  assert.equal(context.userFor({ department: 'Manager' }, user).pin, undefined);
});

test('a successful login captures a migrated PIN for future Admin display', () => {
  const original = [{ id: 'u1', name: 'Pat', department: 'Paint', pin: '1234' }];
  const { context, values } = loadBackend({ USERS: JSON.stringify(original) });
  context.getUsers();
  const migrated = JSON.parse(values.USERS);
  delete migrated[0].adminPin; // represents an account migrated by the previous release
  values.USERS = JSON.stringify(migrated);

  assert.equal(context.checkPin('1234', 'ipad-1').ok, true);
  assert.equal(JSON.parse(values.USERS)[0].adminPin, '1234');
});

test('opening user management as an Admin recovers existing four-digit hashed PINs', () => {
  const original = [{ id: 'u1', name: 'Pat', department: 'Paint', pin: '0007' }];
  const { context, values } = loadBackend({ USERS: JSON.stringify(original) });
  context.getUsers();
  const migrated = JSON.parse(values.USERS);
  delete migrated[0].adminPin;
  values.USERS = JSON.stringify(migrated);

  const visible = context.visibleUsersFor({ id: 'admin', department: 'Admin' });
  assert.equal(visible[0].pin, '0007');
  assert.equal(JSON.parse(values.USERS)[0].adminPin, '0007');
});

test('revoking a user invalidates their existing signed sessions', () => {
  const original = [
    { id: 'admin', name: 'Admin', department: 'Admin', pin: '123456' },
    { id: 'worker', name: 'Pat', department: 'Paint', pin: '654321' },
  ];
  const { context } = loadBackend({ USERS: JSON.stringify(original) });
  const login = context.checkPin('654321', 'ipad-1');
  assert.equal(context.resolveActor(login.token).id, 'worker');
  assert.equal(context.revokeUserSessions({ id: 'admin', department: 'Admin' }, { id: 'worker' }).success, true);
  assert.equal(context.resolveActor(login.token), null);
});

test('note ownership uses immutable user ids and department notes require assignment', () => {
  const { context } = loadBackend();
  const actor = { id: 'u1', name: 'Renamed Pat', department: 'Paint' };
  assert.equal(context.canEditNote(actor, { authorId: 'u1', author: 'Old Pat' }), true);
  assert.equal(context.canEditNote({ ...actor, id: 'u2', name: 'Old Pat' }, { authorId: 'u1', author: 'Old Pat' }), false);
  assert.equal(context.canWriteDepartmentNote(actor, { departments: ['Paint'] }, 'Paint'), true);
  assert.equal(context.canWriteDepartmentNote(actor, { departments: ['Assembly'] }, 'Paint'), false);
});

test('tracking inputs reject malformed keys and dates and neutralize spreadsheet formulas', () => {
  const { context } = loadBackend();
  assert.equal(context.validJobKey('260219'), true);
  assert.equal(context.validJobKey('=IMPORTXML("x")'), false);
  assert.equal(context.validDateOverride('2026-08-07'), true);
  assert.equal(context.validDateOverride('08/07/2026'), false);
  assert.equal(context.sanitizeSheetText('=2+2'), "'=2+2");
  assert.equal(context.sanitizeSheetText('Normal note'), 'Normal note');
});

test('authenticated mutations are idempotent when a request is retried', () => {
  const { context } = loadBackend();
  const actor = { id: 'u1', department: 'Manager' };
  const data = { action: 'addNote', requestId: 'request-12345678' };
  let calls = 0;
  const first = context.runMutationOnce(actor, data, () => ({ success: true, sequence: ++calls }));
  const retry = context.runMutationOnce(actor, data, () => ({ success: true, sequence: ++calls }));
  assert.deepEqual(JSON.parse(JSON.stringify(retry)), JSON.parse(JSON.stringify(first)));
  assert.equal(calls, 1);
  assert.equal(context.runMutationOnce(actor, { ...data, requestId: 'bad id' }, () => ({ success: true })).error, 'Invalid request id');
});
