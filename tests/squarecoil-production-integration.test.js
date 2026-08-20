const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Code.js'), 'utf8');

function loadBackend() {
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Map,
    Set,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => ({
          SQUARECOIL_USERNAME: 'integration-user',
          SQUARECOIL_PASSWORD: 'do-not-log-this',
        })[key] || null,
      }),
    },
  });
  vm.runInContext(source, context);
  return context;
}

test('production file route and settings use Squarecoil instead of Dropbox', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');

  assert.match(source, /return json\(getSquarecoilProductionFile\(jobNum\)\)/);
  assert.match(source, /action === 'getSquarecoilStatus'/);
  assert.match(source, /data\.action === 'refreshSquarecoilFilesNow'/);
  assert.match(app, /squarecoilSettings\.js/);
  assert.match(api, /fetchSquarecoilStatus/);
  assert.match(api, /refreshSquarecoilFilesNow/);
  assert.match(html, /Squarecoil Integration/);

  const retiredSurface = source + app + api + html;
  assert.doesNotMatch(retiredSurface, /api\.dropboxapi\.com|content\.dropboxapi\.com|www\.dropbox\.com\/oauth2/);
  assert.doesNotMatch(retiredSurface, /DROPBOX_APP_KEY|DROPBOX_APP_SECRET|DROPBOX_REFRESH_TOKEN/);
  assert.doesNotMatch(retiredSurface, /getDropboxStatus|getDropboxAuthUrl|disconnectDropbox|refreshDropboxProofsNow/);
});

test('Squarecoil refresh owns the production cache and retires legacy Dropbox triggers', () => {
  assert.match(source, /function refreshSquarecoilProductionFiles\(/);
  assert.match(source, /function scheduledSquarecoilFileRefresh\(/);
  assert.match(source, /function ensureSquarecoilRefreshTrigger\(/);
  assert.match(source, /function resetSquarecoilRefreshTrigger\(/);
  assert.match(source, /SquarecoilFiles/);
  assert.match(source, /scheduledDropboxProofRefresh/);
  assert.match(source, /ScriptApp\.deleteTrigger/);
  assert.match(source, /setupAllTriggers\(\)[\s\S]*ensureSquarecoilRefreshTrigger\(\)/);
});

test('cached Squarecoil production files keep the existing viewer response contract', () => {
  const context = loadBackend();
  context.getCachedSquarecoilFile_ = () => ({
    fileId: '44379',
    name: '251785_Prod_HarmondAscendPropPkg_v9.pdf',
    driveFileId: 'drive-file-44379',
  });
  context.DriveApp = {
    getFileById: id => {
      assert.equal(id, 'drive-file-44379');
      return { getBlob: () => ({ getBytes: () => Buffer.from('%PDF-cached') }) };
    },
  };
  context.Utilities = { base64Encode: bytes => Buffer.from(bytes).toString('base64') };

  const result = context.getSquarecoilProductionFile('251785');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    available: true,
    name: '251785_Prod_HarmondAscendPropPkg_v9.pdf',
    base64: Buffer.from('%PDF-cached').toString('base64'),
  });
});
