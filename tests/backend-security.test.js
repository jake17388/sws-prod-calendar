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

test('all accounts receive unique six-digit temporary PINs in alphabetical order', () => {
  const original = [
    { id: 'u2', name: 'Zoe', department: 'Paint', pin: '2222', authVersion: 1 },
    { id: 'u1', name: 'Aaron', department: 'Admin', pin: '1111', authVersion: 1 },
  ];
  const { context, values } = loadBackend({ USERS: JSON.stringify(original) });

  assert.equal(context.validPin('123456'), true);
  assert.equal(context.validPin('1234'), false);
  const users = context.getUsers();
  assert.deepEqual(
    users.map(user => [user.name, user.adminPin]),
    [['Aaron', '000001'], ['Lionel Gonzalez', '000002'], ['Zoe', '000003']],
  );
  assert.equal(context.checkPin('1111', 'ipad-1').ok, false);
  assert.equal(context.checkPin('000001', 'ipad-1').ok, true);
  assert.equal(JSON.parse(values.USERS).every(user => /^\d{6}$/.test(user.adminPin)), true);
  assert.equal(values.TRAINING_PIN_BATCH, '2026-08-07-six-digit');
});

test('public user records never expose credential material', () => {
  const { context } = loadBackend();
  const publicRecord = context.publicUser({
    id: 'u1', name: 'Pat', department: 'Paint', pin: '123456', adminPin: '123456', pinHash: 'hash', pinSalt: 'salt',
    authVersion: 2, previousAuthVersion: 1, previousAuthExpiresAt: Date.now() + 30000,
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

test('the temporary PIN migration runs only once and keeps later PIN changes', () => {
  const original = [{ id: 'u1', name: 'Aaron', department: 'Admin', pin: '1111', authVersion: 1 }];
  const { context, values } = loadBackend({ USERS: JSON.stringify(original) });
  context.getUsers();
  const migrated = JSON.parse(values.USERS);
  migrated[0] = context.withNewPin(migrated[0], '654321');
  values.USERS = JSON.stringify(migrated);

  assert.equal(context.getUsers()[0].adminPin, '654321');
});

test('revoking a user invalidates their existing signed sessions', () => {
  const original = [
    { id: 'admin', name: 'Admin', department: 'Admin', pin: '123456' },
    { id: 'worker', name: 'Pat', department: 'Paint', pin: '654321' },
  ];
  const { context } = loadBackend({
    USERS: JSON.stringify(original),
    TRAINING_PIN_BATCH: '2026-08-07-six-digit',
  });
  const login = context.checkPin('654321', 'ipad-1');
  assert.equal(context.resolveActor(login.token).id, 'worker');
  assert.equal(context.revokeUserSessions({ id: 'admin', department: 'Admin' }, { id: 'worker' }).success, true);
  assert.equal(context.resolveActor(login.token), null);
});

test('any role can change its own PIN without losing the current session during token handoff', () => {
  const original = [{ id: 'worker', name: 'Pat', department: 'Paint', pin: '123456', authVersion: 1 }];
  const { context, values } = loadBackend({
    USERS: JSON.stringify(original),
    TRAINING_PIN_BATCH: '2026-08-07-six-digit',
  });
  const login = context.checkPin('123456', 'ipad-1');
  const actor = context.resolveActor(login.token);
  const changed = context.updateSelf(actor, { pin: '654321' });

  assert.equal(changed.success, true);
  assert.equal(context.resolveActor(changed.token).department, 'Paint');
  assert.equal(context.resolveActor(login.token).id, 'worker');
  assert.equal(context.checkPin('123456', 'ipad-1').ok, false);
  assert.equal(context.checkPin('654321', 'ipad-1').ok, true);

  const stored = JSON.parse(values.USERS);
  stored[0].previousAuthExpiresAt = Date.now() - 1;
  values.USERS = JSON.stringify(stored);
  assert.equal(context.resolveActor(login.token), null);
});

test('temporary PIN users must choose a different PIN before the requirement clears', () => {
  const original = [{ id: 'worker', name: 'Aaron', department: 'Paint', pin: '000001', authVersion: 1 }];
  const { context } = loadBackend({
    USERS: JSON.stringify(original),
    TRAINING_PIN_BATCH: '2026-08-07-six-digit',
  });
  const login = context.checkPin('000001', 'ipad-1');
  assert.equal(login.mustChangePin, true);
  const actor = context.resolveActor(login.token);
  assert.equal(context.updateSelf(actor, { pin: '000001' }).error, 'Choose a different PIN');
  assert.equal(context.updateSelf(actor, { pin: '654321' }).success, true);
  assert.equal(context.checkPin('654321', 'ipad-1').mustChangePin, false);
});

test('only Admins can rename accounts', () => {
  const original = [
    { id: 'admin', name: 'Admin', department: 'Admin', pin: '111111', authVersion: 1 },
    { id: 'manager', name: 'Manager', department: 'Manager', pin: '222222', authVersion: 1 },
    { id: 'worker', name: 'Pat', department: 'Paint', pin: '333333', authVersion: 1 },
  ];
  const { context } = loadBackend({
    USERS: JSON.stringify(original),
    TRAINING_PIN_BATCH: '2026-08-07-six-digit',
  });
  const manager = context.resolveActor(context.checkPin('222222', 'ipad-1').token);
  const worker = context.resolveActor(context.checkPin('333333', 'ipad-2').token);
  const admin = context.resolveActor(context.checkPin('111111', 'ipad-3').token);

  assert.equal(context.updateSelf(worker, { name: 'Changed' }).error, 'forbidden');
  assert.equal(context.updateUser(manager, { id: 'worker', name: 'Changed' }).error, 'forbidden');
  assert.equal(context.updateUser(admin, { id: 'worker', name: 'Changed' }).success, true);
});

test('four-digit PINs cannot authenticate', () => {
  const { context } = loadBackend({ TRAINING_PIN_BATCH: '2026-08-07-six-digit' });
  const legacy = context.withNewPin({ id: 'u1', name: 'Pat', department: 'Viewer', authVersion: 1 }, '1234');
  context.saveUsers([legacy]);
  assert.equal(context.checkPin('1234', 'ipad-1').ok, false);
});

test('note ownership uses immutable user ids', () => {
  const { context } = loadBackend();
  const actor = { id: 'u1', name: 'Renamed Pat', department: 'Paint' };
  assert.equal(context.canEditNote(actor, { authorId: 'u1', author: 'Old Pat' }), true);
  assert.equal(context.canEditNote({ ...actor, id: 'u2', name: 'Old Pat' }, { authorId: 'u1', author: 'Old Pat' }), false);
});

test('every authenticated role can write shared project notes and department scope is retired', () => {
  const { context } = loadBackend();
  ['Admin', 'Manager', 'Viewer', 'Manufacturing', 'Graphics', 'Paint', 'Assembly', 'Letters', 'Routing']
    .forEach(department => assert.equal(context.canWriteNote({ department }), true));
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.noteScopeAndDept({ scope: 'department', department: 'Paint' }))),
    { scope: 'project', department: '' },
  );
});

test('legacy department notes merge into the shared project timeline without duplicates', () => {
  const { context } = loadBackend();
  const project = [{ id: 'project-1', text: 'Project', author: 'Pat', createdAt: '2026-08-10T10:00:00.000Z' }];
  const department = {
    Paint: [
      { id: 'department-1', text: 'Paint', author: 'Alex', createdAt: '2026-08-10T09:00:00.000Z' },
      project[0],
    ],
  };
  const merged = context.mergeLegacyDepartmentNotes(project, department);
  assert.deepEqual(merged.map(note => note.id), ['department-1', 'project-1']);
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
