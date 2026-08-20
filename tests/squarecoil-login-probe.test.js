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

test('Squarecoil PDF parser accepts numeric HTML encoding from the raw design response', () => {
  const { context } = loadBackend({}, []);
  const html = [
    '<strong>260262-04</strong>',
    '<a target="_blank" href="download_design_file.php?file_id=45528&#038;project_id=260262">',
    '  260262_Prod_TelaVerdeApts_v4.pdf  </a>',
  ].join('');

  const result = context.squarecoilFindPdfLink_(html, '260262');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    fileId: '45528',
    name: '260262_Prod_TelaVerdeApts_v4.pdf',
  });
});

test('Squarecoil PDF parser accepts an unquoted href from the raw PHP response', () => {
  const { context } = loadBackend({}, []);
  const html = [
    '<strong>260262-04</strong>',
    '<a target=_blank href=download_design_file.php?file_id=45528&amp;project_id=260262>',
    '260262_Prod_TelaVerdeApts_v4.pdf</a>',
  ].join('');

  const result = context.squarecoilFindPdfLink_(html, '260262');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    fileId: '45528',
    name: '260262_Prod_TelaVerdeApts_v4.pdf',
  });
});

test('Squarecoil probe reports sanitized parser diagnostics when a design has no PDF link', () => {
  const designHtml = '<strong>260262-04</strong><a href="project_designs.php?id=260262">Design</a>';
  const responses = [
    response(200, '<form action="login.php"><input name="username"></form>', {
      'Set-Cookie': 'PHPSESSID=anonymous; Path=/; HttpOnly',
    }),
    response(302, '', {
      'Set-Cookie': 'PHPSESSID=authenticated; Path=/; HttpOnly',
      Location: 'dashboard.php',
    }),
    response(200, '<a href="dashboard.php">Dashboard</a>'),
    response(200, designHtml),
  ];
  const { context, logs } = loadBackend({
    SQUARECOIL_USERNAME: 'integration-user',
    SQUARECOIL_PASSWORD: 'do-not-log-this',
  }, responses);

  const result = context.testSquarecoilLogin();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    stage: 'design',
    error: 'No PDF was found on the expected design',
    diagnostics: {
      responseCode: 200,
      htmlCharacters: designHtml.length,
      downloadEndpointCount: 0,
      pdfTextCount: 0,
    },
  });
  assert.equal(logs[0], JSON.stringify(result));
  assert.doesNotMatch(logs[0], /integration-user|do-not-log-this|PHPSESSID/);
});

test('Squarecoil revision parser selects revision 11 and ignores duplicate date links', () => {
  const { context } = loadBackend({}, []);
  const html = [
    '<a href="project_designs.php?id=251785&amp;designid=28492">11/24/2025</a>',
    '<a href="project_designs.php?id=251785&amp;designid=28492">251785-01</a>',
    '<a href="project_designs.php?id=251785&amp;designid=29249">03/09/2026</a>',
    '<a href="project_designs.php?id=251785&amp;designid=29249">251785-10</a>',
    '<a href=project_designs.php?id=251785&amp;designid=29290>03/13/2026</a>',
    '<a href=project_designs.php?id=251785&amp;designid=29290>251785-11</a>',
  ].join('');

  const revisions = context.squarecoilFindDesignRevisions_(html, '251785');

  assert.deepEqual(JSON.parse(JSON.stringify(revisions)), [
    { designId: '29290', designNumber: '251785-11', revision: 11 },
    { designId: '29249', designNumber: '251785-10', revision: 10 },
    { designId: '28492', designNumber: '251785-01', revision: 1 },
  ]);
});

test('general Squarecoil probe downloads the latest revision and handles a job with no designs', () => {
  const username = 'integration-user';
  const password = 'do-not-log-this';
  const revisionList = [
    '<a href="project_designs.php?id=251785&amp;designid=28492">251785-01</a>',
    '<a href="project_designs.php?id=251785&amp;designid=29249">251785-10</a>',
    '<a href="project_designs.php?id=251785&amp;designid=29290">251785-11</a>',
  ].join('');
  const responses = [
    response(200, '<form action="login.php"><input name="username"></form>', {
      'Set-Cookie': 'PHPSESSID=anonymous; Path=/; HttpOnly',
    }),
    response(302, '', {
      'Set-Cookie': 'PHPSESSID=authenticated; Path=/; HttpOnly',
      Location: 'dashboard.php',
    }),
    response(200, '<a href="dashboard.php">Dashboard</a>'),
    response(200, revisionList),
    response(200, [
      '<strong>251785-11</strong>',
      '<a target=_blank href=download_design_file.php?file_id=44379&amp;project_id=251785>',
      '251785_Prod_HarmondAscendPropPkg_v9.pdf</a>',
    ].join('')),
    response(200, '', { 'Content-Type': 'application/pdf' }, Buffer.from('%PDF-1.7\nlatest')),
    response(200, '<h1>261364</h1><div>Designs</div><a href="new_design.php?project_id=261364">New</a>'),
  ];
  const { context, requests, logs } = loadBackend({
    SQUARECOIL_USERNAME: username,
    SQUARECOIL_PASSWORD: password,
  }, responses);

  const result = context.testSquarecoilJobLookup();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    {
      success: true,
      jobNum: '251785',
      designNumber: '251785-11',
      designId: '29290',
      fileId: '44379',
      fileName: '251785_Prod_HarmondAscendPropPkg_v9.pdf',
      responseCode: 200,
      bytes: 15,
      pdfValid: true,
    },
    {
      success: true,
      jobNum: '261364',
      fileFound: false,
      reason: 'no_designs',
    },
  ]);
  assert.match(requests[3].url, /project_designs\.php\?id=251785$/);
  assert.match(requests[4].url, /id=251785&designid=29290$/);
  assert.match(requests[5].url, /file_id=44379&project_id=251785$/);
  assert.match(requests[6].url, /project_designs\.php\?id=261364$/);
  const observable = JSON.stringify(result) + logs.join('\n');
  assert.doesNotMatch(observable, new RegExp(username));
  assert.doesNotMatch(observable, new RegExp(password));
  assert.doesNotMatch(observable, /PHPSESSID/);
});
