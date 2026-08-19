const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');

function response(code, body = '', headers = {}, bytes = null) {
  return {
    getResponseCode: () => code,
    getContentText: () => body,
    getAllHeaders: () => headers,
    getHeaders: () => headers,
    getBlob: () => ({ getBytes: () => bytes || Buffer.from(body) }),
  };
}

function loadBackend(properties, responses) {
  const requests = [];
  const logs = [];
  const context = vm.createContext({
    console: { log: value => logs.push(String(value)), error() {}, warn() {} },
    Date,
    JSON,
    Map,
    Set,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => properties[key] || null }),
    },
    UrlFetchApp: {
      fetch: (url, options = {}) => {
        requests.push({ url, options });
        if (!responses.length) throw new Error(`Unexpected request: ${url}`);
        return responses.shift();
      },
    },
  });
  vm.runInContext(source, context);
  return { context, requests, logs };
}

test('Squarecoil credential probe authenticates and validates the expected production PDF', () => {
  const username = 'integration-user';
  const password = 'do-not-log-this';
  const responses = [
    response(200, '<form action="login.php"><input name="username"></form>', {
      'Set-Cookie': 'PHPSESSID=anonymous; Path=/; HttpOnly',
    }),
    response(302, '', {
      'Set-Cookie': 'PHPSESSID=authenticated; Path=/; HttpOnly',
      Location: 'dashboard.php',
    }),
    response(200, '<a href="dashboard.php">Dashboard</a><a href="project.php?id=260262">Project</a>'),
    response(200, [
      '<strong>260262-04</strong>',
      '<a href="download_design_file.php?file_id=45528&amp;project_id=260262">',
      '260262_Prod_TelaVerdeApts_v4.pdf</a>',
    ].join('')),
    response(200, '', { 'Content-Type': 'application/pdf' }, Buffer.from('%PDF-1.7\nprobe')),
  ];
  const { context, requests, logs } = loadBackend({
    SQUARECOIL_USERNAME: username,
    SQUARECOIL_PASSWORD: password,
  }, responses);

  const result = context.testSquarecoilLogin();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: true,
    jobNum: '260262',
    designNumber: '260262-04',
    designId: '30216',
    fileId: '45528',
    fileName: '260262_Prod_TelaVerdeApts_v4.pdf',
    responseCode: 200,
    bytes: 14,
    pdfValid: true,
  });
  assert.equal(requests.length, 5);
  assert.equal(requests[1].options.payload.username, username);
  assert.equal(requests[1].options.payload.password, password);
  assert.match(requests[2].options.headers.Cookie, /PHPSESSID=authenticated/);
  assert.match(requests[3].options.headers.Cookie, /PHPSESSID=authenticated/);
  assert.match(requests[4].options.headers.Cookie, /PHPSESSID=authenticated/);
  const observable = JSON.stringify(result) + logs.join('\n');
  assert.doesNotMatch(observable, new RegExp(username));
  assert.doesNotMatch(observable, new RegExp(password));
  assert.doesNotMatch(observable, /PHPSESSID/);
});

test('Squarecoil credential probe fails safely when credentials are missing', () => {
  const { context, requests, logs } = loadBackend({}, []);

  const result = context.testSquarecoilLogin();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    stage: 'configuration',
    error: 'Squarecoil credentials are not configured',
  });
  assert.equal(requests.length, 0);
  assert.deepEqual(logs, [JSON.stringify(result)]);
});
