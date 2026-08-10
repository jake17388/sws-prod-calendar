const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');

function loadBackend() {
  const values = {};
  let uuid = 0;
  let trashed = false;
  const storedFile = {
    getId: () => 'drive-file-1',
    getBlob: () => ({ getBytes: () => Buffer.from('hello') }),
    setTrashed: value => { trashed = value; },
  };
  const folder = { createFile: () => storedFile };
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Map,
    Set,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => values[key] || null,
      setProperty: (key, value) => { values[key] = value; },
    }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      base64Decode: value => Buffer.from(value, 'base64'),
      base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
    },
    DriveApp: {
      createFolder: () => folder,
      getFolderById: () => folder,
      getFileById: () => storedFile,
    },
  });
  vm.runInContext(source, context);
  return { context, wasTrashed: () => trashed };
}

test('Admins, Managers, and Viewers can upload additional files but production roles cannot', () => {
  const { context } = loadBackend();

  ['Admin', 'Manager', 'Viewer'].forEach(role => assert.equal(context.canUploadAdditionalFiles(role), true));
  ['Manufacturing', 'Graphics', 'Paint', 'Assembly', 'Letters', 'Routing']
    .forEach(role => assert.equal(context.canUploadAdditionalFiles(role), false));
});

test('an uploaded file is stored with immutable author and timestamp metadata', () => {
  const { context } = loadBackend();
  context.canAccessJobKey = () => true;
  context.setTracking = (jobKey, patch) => {
    const current = { additionalFiles: [] };
    return { success: true, ...current, ...patch(current), updatedAt: 'updated' };
  };

  const result = context.addAdditionalFile(
    { id: 'viewer-1', name: 'Vera Viewer', department: 'Viewer' },
    { jobKey: '260001', name: 'install-photo.jpg', mimeType: 'image/jpeg', base64: Buffer.from('hello').toString('base64') },
  );

  assert.equal(result.success, true);
  assert.equal(result.additionalFiles.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.additionalFiles[0])), {
    id: 'uuid-1',
    fileId: 'drive-file-1',
    name: 'install-photo.jpg',
    mimeType: 'image/jpeg',
    size: 5,
    addedBy: 'Vera Viewer',
    addedById: 'viewer-1',
    addedAt: result.additionalFiles[0].addedAt,
  });
  assert.match(result.additionalFiles[0].addedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('only an Admin can delete an additional file', () => {
  const { context, wasTrashed } = loadBackend();
  const file = { id: 'file-1', fileId: 'drive-file-1', name: 'photo.jpg' };
  context.canAccessJobKey = () => true;
  context.setTracking = (jobKey, patch) => {
    const current = { additionalFiles: [file] };
    const resolved = patch(current);
    if (resolved.error) return { success: false, error: resolved.error };
    return { success: true, ...current, ...resolved };
  };

  assert.equal(context.deleteAdditionalFile(
    { id: 'manager-1', name: 'Morgan', department: 'Manager' },
    { jobKey: '260001', fileId: 'file-1' },
  ).error, 'forbidden');
  assert.equal(wasTrashed(), false);

  const deleted = context.deleteAdditionalFile(
    { id: 'admin-1', name: 'Ada', department: 'Admin' },
    { jobKey: '260001', fileId: 'file-1' },
  );
  assert.equal(deleted.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(deleted.additionalFiles)), []);
  assert.equal(wasTrashed(), true);
});

test('the project screen labels the proof as Production File and provides drag-and-drop additional files', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const component = fs.readFileSync(path.join(__dirname, '..', 'js/components/jobDetail.js'), 'utf8');

  assert.match(html, /<h3>Production File<\/h3>/);
  assert.match(html, /id="job-detail-additional-dropzone"/);
  assert.match(component, /dragover/);
  assert.match(component, /uploadAdditionalFile/);
  assert.match(component, /deleteAdditionalFile/);
});
