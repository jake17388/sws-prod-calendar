// ── Squarecoil Production Files ─────────────────────────────────────────────
// Credentials live only in Script Properties and are never returned or logged.
// One authenticated PHP session is reused across each lookup or cache refresh.
const SQUARECOIL_BASE_URL = 'https://summitwestsigns.squarecoil.net';

function squarecoilCredentials_() {
  const props = PropertiesService.getScriptProperties();
  return {
    username: props.getProperty('SQUARECOIL_USERNAME') || '',
    password: props.getProperty('SQUARECOIL_PASSWORD') || '',
  };
}

function isSquarecoilConfigured_() {
  const credentials = squarecoilCredentials_();
  return !!(credentials.username && credentials.password);
}

function squarecoilResponseHeader_(response, name) {
  const headers = response.getAllHeaders ? response.getAllHeaders() : response.getHeaders();
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers || {}).find(header => String(header).toLowerCase() === wanted);
  return key ? headers[key] : '';
}

function squarecoilMergeCookies_(currentCookie, response) {
  const merged = {};
  String(currentCookie || '').split(/;\s*/).forEach(pair => {
    const equals = pair.indexOf('=');
    if (equals > 0) merged[pair.slice(0, equals).trim()] = pair.slice(equals + 1).trim();
  });

  const raw = squarecoilResponseHeader_(response, 'Set-Cookie');
  const cookies = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/,(?=\s*[^;,=\s]+=)/);
  cookies.forEach(cookie => {
    const match = String(cookie).match(/^\s*([^=;,\s]+)=([^;]*)/);
    if (match) merged[match[1]] = match[2];
  });
  return Object.keys(merged).map(key => key + '=' + merged[key]).join('; ');
}

function squarecoilUrl_(path) {
  const value = String(path || '');
  if (/^https:\/\//i.test(value)) return value;
  return SQUARECOIL_BASE_URL + '/' + value.replace(/^\/+/, '');
}

function squarecoilGet_(path, cookie) {
  return UrlFetchApp.fetch(squarecoilUrl_(path), {
    method: 'get',
    headers: {
      Cookie: cookie,
      Accept: 'text/html,application/xhtml+xml,application/pdf',
      'User-Agent': 'Mozilla/5.0 (compatible; SWS-Production-Calendar/1.0)',
    },
    followRedirects: false,
    muteHttpExceptions: true,
  });
}

function squarecoilGetBatch_(paths, cookie) {
  const results = [];
  for (let i = 0; i < paths.length; i += SQUARECOIL_BATCH_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + SQUARECOIL_BATCH_CHUNK_SIZE);
    const requests = chunk.map(path => ({
      url: squarecoilUrl_(path),
      method: 'get',
      headers: {
        Cookie: cookie,
        Accept: 'text/html,application/xhtml+xml,application/pdf',
        'User-Agent': 'Mozilla/5.0 (compatible; SWS-Production-Calendar/1.0)',
      },
      followRedirects: false,
      muteHttpExceptions: true,
    }));
    let responses;
    try { responses = UrlFetchApp.fetchAll(requests); } catch (err) { responses = chunk.map(() => null); }
    responses.forEach(response => results.push(response));
  }
  return results;
}

function squarecoilLogin_(username, password) {
  const initial = UrlFetchApp.fetch(SQUARECOIL_BASE_URL + '/login.php', {
    method: 'get',
    followRedirects: false,
    muteHttpExceptions: true,
  });
  let cookie = squarecoilMergeCookies_('', initial);
  const login = UrlFetchApp.fetch(SQUARECOIL_BASE_URL + '/login.php', {
    method: 'post',
    payload: {
      action: '1',
      username,
      password,
      latlong: '',
      latlong_error: '',
      latitude: '',
      longitude: '',
    },
    headers: {
      Cookie: cookie,
      'User-Agent': 'Mozilla/5.0 (compatible; SWS-Production-Calendar/1.0)',
    },
    followRedirects: false,
    muteHttpExceptions: true,
  });
  cookie = squarecoilMergeCookies_(cookie, login);

  const code = login.getResponseCode();
  const location = squarecoilResponseHeader_(login, 'Location');
  const authenticated = code >= 300 && code < 400 && location
    ? squarecoilGet_(location, cookie)
    : login;
  cookie = squarecoilMergeCookies_(cookie, authenticated);
  const html = authenticated.getContentText();
  if (authenticated.getResponseCode() !== 200
      || /<form[^>]+action=["']login\.php/i.test(html)
      || !/(?:dashboard\.php|project\.php)/i.test(html)) {
    throw new Error('Squarecoil rejected the login or changed its login flow');
  }
  return cookie;
}

function squarecoilDecodeHtmlEntities_(value) {
  let decoded = String(value || '');
  // Raw PHP responses may use named or numeric encodings. Decode a few
  // passes so double-encoded query separators are
  // handled the same way a browser's HTML parser handles them.
  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/&(amp|#0*38|#x0*26);/gi, '&')
      .replace(/&(quot|#0*34|#x0*22);/gi, '"')
      .replace(/&(#0*39|#x0*27);/gi, "'");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function squarecoilDecodeText_(value) {
  return squarecoilDecodeHtmlEntities_(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#0*160;|&#x0*a0;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function squarecoilFindProjectName_(html, jobNum) {
  const headings = String(html || '').match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
  const texts = headings.map(squarecoilDecodeText_).filter(Boolean);
  if (texts.indexOf(String(jobNum || '')) === -1) return '';
  return texts.find(text => text !== String(jobNum || '') && text.length <= 300) || '';
}

function lookupSquarecoilJob_(jobNum) {
  const value = String(jobNum || '').trim();
  if (!validJobKey(value)) return { success: false, found: false, error: 'Enter a valid five- or six-digit job number' };
  if (!isSquarecoilConfigured_()) return { success: false, found: false, error: 'Squarecoil is not configured' };

  const cache = CacheService.getScriptCache();
  const cacheKey = 'squarecoil_job_' + value;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* fetch fresh below */ }
  }

  try {
    const credentials = squarecoilCredentials_();
    const cookie = squarecoilLogin_(credentials.username, credentials.password);
    const response = squarecoilGet_('project.php?id=' + value, cookie);
    const name = response.getResponseCode() === 200
      ? squarecoilFindProjectName_(response.getContentText(), value)
      : '';
    const result = name
      ? { success: true, found: true, job: { jobNum: value, name } }
      : { success: true, found: false, error: 'No Squarecoil job was found with that number' };
    cache.put(cacheKey, JSON.stringify(result), name ? 21600 : 300);
    return result;
  } catch (err) {
    console.warn('Squarecoil job metadata lookup failed for %s: %s', value, err && err.message);
    return { success: false, found: false, error: 'Could not reach Squarecoil — try again' };
  }
}

function squarecoilFindPdfLink_(html, jobNum) {
  const normalized = squarecoilDecodeHtmlEntities_(html);
  const links = normalized.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (let i = 0; i < links.length; i++) {
    const hrefMatch = links[i].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [];
    const href = hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '';
    if (!/download_design_file\.php\?/i.test(href)) continue;
    const fileId = (href.match(/[?&]file_id=(\d+)/i) || [])[1] || '';
    const projectId = (href.match(/[?&]project_id=(\d+)/i) || [])[1] || '';
    const name = squarecoilDecodeText_((links[i].match(/>([\s\S]*?)<\/a>/i) || [])[1]);
    if (fileId && projectId === String(jobNum) && /\.pdf$/i.test(name)) return { fileId, name };
  }
  return null;
}

function squarecoilFindDesignRevisions_(html, jobNum) {
  const normalized = squarecoilDecodeHtmlEntities_(html);
  const links = normalized.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  const byDesignId = {};
  const numberPattern = new RegExp('^' + String(jobNum) + '-(\\d+)$');

  links.forEach(link => {
    const hrefMatch = link.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [];
    const href = hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '';
    if (!/project_designs\.php\?/i.test(href)) return;
    const projectId = (href.match(/[?&]id=(\d+)/i) || [])[1] || '';
    const designId = (href.match(/[?&]designid=(\d+)/i) || [])[1] || '';
    const designNumber = squarecoilDecodeText_((link.match(/>([\s\S]*?)<\/a>/i) || [])[1]);
    const numberMatch = designNumber.match(numberPattern);
    if (projectId !== String(jobNum) || !designId || !numberMatch) return;
    byDesignId[designId] = { designId, designNumber, revision: Number(numberMatch[1]) };
  });

  return Object.keys(byDesignId)
    .map(designId => byDesignId[designId])
    .sort((a, b) => b.revision - a.revision || Number(b.designId) - Number(a.designId));
}

function squarecoilLookupLatestJob_(jobNum, cookie) {
  const resolved = squarecoilResolveLatestFile_(jobNum, cookie);
  if (!resolved.success || !resolved.fileFound) return resolved;

  const download = squarecoilGet_(
    'download_design_file.php?file_id=' + resolved.fileId + '&project_id=' + resolved.jobNum,
    cookie
  );
  const bytes = download.getBlob().getBytes();
  return {
    success: download.getResponseCode() === 200 && squarecoilLooksLikePdf_(bytes),
    jobNum: resolved.jobNum,
    designNumber: resolved.designNumber,
    designId: resolved.designId,
    fileId: resolved.fileId,
    fileName: resolved.fileName,
    responseCode: download.getResponseCode(),
    bytes: bytes.length,
    pdfValid: squarecoilLooksLikePdf_(bytes),
  };
}

function squarecoilResolveLatestFile_(jobNum, cookie) {
  const value = String(jobNum || '').trim();
  if (!/^\d{5,6}$/.test(value)) {
    return { success: false, jobNum: value, stage: 'validation', error: 'Invalid Squarecoil job number' };
  }

  const listResponse = squarecoilGet_('project_designs.php?id=' + value, cookie);
  if (listResponse.getResponseCode() !== 200) {
    return { success: false, jobNum: value, stage: 'design_list', error: 'Squarecoil design list was not accessible' };
  }
  const revisions = squarecoilFindDesignRevisions_(listResponse.getContentText(), value);
  if (!revisions.length) return { success: true, jobNum: value, fileFound: false, reason: 'no_designs' };

  const latest = revisions[0];
  const designResponse = squarecoilGet_(
    'project_designs.php?id=' + value + '&designid=' + latest.designId,
    cookie
  );
  const designHtml = designResponse.getContentText();
  if (designResponse.getResponseCode() !== 200 || designHtml.indexOf(latest.designNumber) === -1) {
    return { success: false, jobNum: value, stage: 'design', error: 'Latest Squarecoil design was not accessible' };
  }

  const file = squarecoilFindPdfLink_(designHtml, value);
  if (!file) {
    return {
      success: true,
      jobNum: value,
      fileFound: false,
      reason: 'no_pdf',
      designNumber: latest.designNumber,
      designId: latest.designId,
    };
  }
  return {
    success: true,
    fileFound: true,
    jobNum: value,
    designNumber: latest.designNumber,
    designId: latest.designId,
    fileId: file.fileId,
    fileName: file.name,
  };
}

function squarecoilDesignDiagnostics_(html, responseCode) {
  const value = String(html || '');
  return {
    responseCode,
    htmlCharacters: value.length,
    downloadEndpointCount: (value.match(/download_design_file\.php/gi) || []).length,
    pdfTextCount: (value.match(/\.pdf\b/gi) || []).length,
  };
}

function squarecoilLooksLikePdf_(bytes) {
  return !!bytes && bytes.length >= 5
    && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68
    && bytes[3] === 70 && bytes[4] === 45;
}

function squarecoilProbeResult_(result) {
  console.log(JSON.stringify(result));
  return result;
}

function testSquarecoilLogin() {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty('SQUARECOIL_USERNAME') || '';
  const password = props.getProperty('SQUARECOIL_PASSWORD') || '';
  if (!username || !password) {
    return squarecoilProbeResult_({ success: false, stage: 'configuration', error: 'Squarecoil credentials are not configured' });
  }

  const jobNum = '260262';
  const designNumber = '260262-04';
  const designId = '30216';
  try {
    const cookie = squarecoilLogin_(username, password);
    const design = squarecoilGet_('project_designs.php?id=' + jobNum + '&designid=' + designId, cookie);
    const designHtml = design.getContentText();
    if (design.getResponseCode() !== 200 || designHtml.indexOf(designNumber) === -1) {
      return squarecoilProbeResult_({ success: false, stage: 'design', error: 'Expected Squarecoil design was not accessible' });
    }
    const file = squarecoilFindPdfLink_(designHtml, jobNum);
    if (!file) {
      return squarecoilProbeResult_({
        success: false,
        stage: 'design',
        error: 'No PDF was found on the expected design',
        diagnostics: squarecoilDesignDiagnostics_(designHtml, design.getResponseCode()),
      });
    }

    const download = squarecoilGet_('download_design_file.php?file_id=' + file.fileId + '&project_id=' + jobNum, cookie);
    const bytes = download.getBlob().getBytes();
    const result = {
      success: download.getResponseCode() === 200 && squarecoilLooksLikePdf_(bytes),
      jobNum,
      designNumber,
      designId,
      fileId: file.fileId,
      fileName: file.name,
      responseCode: download.getResponseCode(),
      bytes: bytes.length,
      pdfValid: squarecoilLooksLikePdf_(bytes),
    };
    return squarecoilProbeResult_(result);
  } catch (err) {
    const result = { success: false, stage: 'login', error: String((err && err.message) || err || 'Squarecoil probe failed').slice(0, 200) };
    return squarecoilProbeResult_(result);
  }
}

function testSquarecoilJobLookup() {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty('SQUARECOIL_USERNAME') || '';
  const password = props.getProperty('SQUARECOIL_PASSWORD') || '';
  if (!username || !password) {
    return squarecoilProbeResult_({ success: false, stage: 'configuration', error: 'Squarecoil credentials are not configured' });
  }

  try {
    const cookie = squarecoilLogin_(username, password);
    return squarecoilProbeResult_([
      squarecoilLookupLatestJob_('251785', cookie),
      squarecoilLookupLatestJob_('261364', cookie),
    ]);
  } catch (err) {
    return squarecoilProbeResult_({
      success: false,
      stage: 'login',
      error: String((err && err.message) || err || 'Squarecoil job lookup failed').slice(0, 200),
    });
  }
}

function squarecoilResolveFilesBatch_(jobNums, cookie) {
  const unique = Array.from(new Set((jobNums || []).map(value => String(value || '').trim()).filter(value => /^\d{5,6}$/.test(value))));
  const resolved = {};
  const listResponses = squarecoilGetBatch_(unique.map(jobNum => 'project_designs.php?id=' + jobNum), cookie);
  const detailJobs = [];

  unique.forEach((jobNum, index) => {
    const response = listResponses[index];
    if (!response || response.getResponseCode() !== 200) {
      resolved[jobNum] = { success: false, jobNum, stage: 'design_list' };
      return;
    }
    const revisions = squarecoilFindDesignRevisions_(response.getContentText(), jobNum);
    if (!revisions.length) {
      resolved[jobNum] = { success: true, jobNum, fileFound: false, reason: 'no_designs' };
      return;
    }
    detailJobs.push({ jobNum, latest: revisions[0] });
  });

  const detailResponses = squarecoilGetBatch_(detailJobs.map(item => (
    'project_designs.php?id=' + item.jobNum + '&designid=' + item.latest.designId
  )), cookie);
  detailJobs.forEach((item, index) => {
    const response = detailResponses[index];
    if (!response || response.getResponseCode() !== 200) {
      resolved[item.jobNum] = { success: false, jobNum: item.jobNum, stage: 'design' };
      return;
    }
    const file = squarecoilFindPdfLink_(response.getContentText(), item.jobNum);
    if (!file) {
      resolved[item.jobNum] = {
        success: true,
        jobNum: item.jobNum,
        fileFound: false,
        reason: 'no_pdf',
        designNumber: item.latest.designNumber,
        designId: item.latest.designId,
      };
      return;
    }
    resolved[item.jobNum] = {
      success: true,
      fileFound: true,
      jobNum: item.jobNum,
      designNumber: item.latest.designNumber,
      designId: item.latest.designId,
      fileId: file.fileId,
      fileName: file.name,
    };
  });
  return resolved;
}

function getSquarecoilFilesSheet_() {
  const ss = getTrackingSpreadsheet();
  let sheet = ss.getSheetByName('SquarecoilFiles');
  if (!sheet) {
    sheet = ss.insertSheet('SquarecoilFiles');
    sheet.appendRow(['job_num', 'design_id', 'design_number', 'file_id', 'file_name', 'checked_at', 'drive_file_id']);
  }
  return sheet;
}

function getProductionFileCacheFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('PROOF_CACHE_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder('SWS Prod Calendar - Cached Production Files');
  props.setProperty('PROOF_CACHE_FOLDER_ID', folder.getId());
  return folder;
}

function squarecoilCacheRows_(sheet) {
  const data = sheet.getDataRange().getValues();
  const rows = {};
  for (let i = 1; i < data.length; i++) {
    rows[String(data[i][0])] = { rowIndex: i + 1, values: data[i] };
  }
  return rows;
}

function writeSquarecoilCacheRow_(sheet, rowIndex, values) {
  if (rowIndex) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
}

function trashDriveFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { /* already gone */ }
}

function getCachedSquarecoilFile_(jobNum) {
  const sheet = getSquarecoilFilesSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jobNum) && data[i][3]) {
      return {
        designId: String(data[i][1] || ''),
        designNumber: String(data[i][2] || ''),
        fileId: String(data[i][3] || ''),
        name: String(data[i][4] || ''),
        checkedAt: String(data[i][5] || ''),
        driveFileId: String(data[i][6] || ''),
      };
    }
  }
  return null;
}

function cacheSquarecoilFile_(resolved, blob) {
  const sheet = getSquarecoilFilesSheet_();
  const rows = squarecoilCacheRows_(sheet);
  const previous = rows[resolved.jobNum];
  const previousDriveFileId = previous ? previous.values[6] : '';
  let driveFileId = '';
  try {
    const folder = getProductionFileCacheFolder_();
    driveFileId = folder.createFile(blob.setName(resolved.jobNum + '.pdf')).getId();
    if (previousDriveFileId && previousDriveFileId !== driveFileId) trashDriveFile_(previousDriveFileId);
  } catch (err) {
    driveFileId = '';
  }
  writeSquarecoilCacheRow_(sheet, previous && previous.rowIndex, [
    resolved.jobNum,
    resolved.designId,
    resolved.designNumber,
    resolved.fileId,
    resolved.fileName,
    new Date().toISOString(),
    driveFileId,
  ]);
  return driveFileId;
}

function refreshSquarecoilProductionFiles() {
  const credentials = squarecoilCredentials_();
  if (!credentials.username || !credentials.password) throw new Error('Squarecoil credentials are not configured');

  const range = defaultCalendarWindow();
  const tracking = getAllTracking();
  const jobNums = Array.from(new Set(getCalendarJobs(range.start, range.end)
    .filter(job => !(tracking[job.jobNum] && tracking[job.jobNum].completed))
    .map(job => String(job.jobNum))));
  const cookie = squarecoilLogin_(credentials.username, credentials.password);
  const resolvedByJob = squarecoilResolveFilesBatch_(jobNums, cookie);
  const sheet = getSquarecoilFilesSheet_();
  const rows = squarecoilCacheRows_(sheet);
  const changed = [];

  jobNums.forEach(jobNum => {
    const resolved = resolvedByJob[jobNum];
    const previous = rows[jobNum];
    if (!resolved || !resolved.success || !resolved.fileFound) return;
    const previousFileId = previous ? String(previous.values[3] || '') : '';
    const previousDriveFileId = previous ? String(previous.values[6] || '') : '';
    if (resolved.fileId !== previousFileId || !previousDriveFileId) changed.push(resolved);
  });

  const downloads = squarecoilGetBatch_(changed.map(resolved => (
    'download_design_file.php?file_id=' + resolved.fileId + '&project_id=' + resolved.jobNum
  )), cookie);
  const downloadByJob = {};
  changed.forEach((resolved, index) => { downloadByJob[resolved.jobNum] = downloads[index] || null; });

  let folder = null;
  let refreshed = 0;
  let unavailable = 0;
  let failed = 0;
  const checkedAt = new Date().toISOString();
  jobNums.forEach(jobNum => {
    const resolved = resolvedByJob[jobNum];
    const previous = rows[jobNum];
    if (!resolved || !resolved.success) { failed++; return; }

    const previousDriveFileId = previous ? String(previous.values[6] || '') : '';
    if (!resolved.fileFound) {
      trashDriveFile_(previousDriveFileId);
      writeSquarecoilCacheRow_(sheet, previous && previous.rowIndex, [jobNum, '', '', '', '', checkedAt, '']);
      unavailable++;
      return;
    }

    const previousFileId = previous ? String(previous.values[3] || '') : '';
    let driveFileId = previousDriveFileId;
    if (resolved.fileId !== previousFileId || !driveFileId) {
      const response = downloadByJob[jobNum];
      const bytes = response && response.getResponseCode() === 200 ? response.getBlob().getBytes() : null;
      if (!squarecoilLooksLikePdf_(bytes)) { failed++; return; }
      try {
        if (!folder) folder = getProductionFileCacheFolder_();
        const blob = response.getBlob().setName(jobNum + '.pdf');
        const nextDriveFileId = folder.createFile(blob).getId();
        trashDriveFile_(previousDriveFileId);
        driveFileId = nextDriveFileId;
      } catch (err) {
        failed++;
        return;
      }
    }

    writeSquarecoilCacheRow_(sheet, previous && previous.rowIndex, [
      jobNum,
      resolved.designId,
      resolved.designNumber,
      resolved.fileId,
      resolved.fileName,
      checkedAt,
      driveFileId,
    ]);
    refreshed++;
  });
  const summary = { success: true, checked: jobNums.length, refreshed, unavailable, failed };
  Logger.log(JSON.stringify(summary));
  return summary;
}

function evictSquarecoilFileCache(jobNum) {
  const sheet = getSquarecoilFilesSheet_();
  const rows = squarecoilCacheRows_(sheet);
  const row = rows[String(jobNum)];
  if (!row) return;
  trashDriveFile_(row.values[6]);
  sheet.getRange(row.rowIndex, 7).setValue('');
}

function getSquarecoilProductionFile(jobNum) {
  if (!jobNum || !isSquarecoilConfigured_()) return { available: false };
  let cached = null;
  try { cached = getCachedSquarecoilFile_(jobNum); } catch (err) {
    console.warn('Squarecoil Production File cache read failed for %s: %s', jobNum, err && err.message);
  }
  if (cached && cached.driveFileId) {
    try {
      const blob = DriveApp.getFileById(cached.driveFileId).getBlob();
      const bytes = blob.getBytes();
      if (squarecoilLooksLikePdf_(bytes)) {
        return { available: true, name: cached.name, base64: Utilities.base64Encode(bytes) };
      }
    } catch (err) {
      // Missing or invalid Drive copy falls through to a live Squarecoil fetch.
    }
  }

  try {
    const credentials = squarecoilCredentials_();
    const cookie = squarecoilLogin_(credentials.username, credentials.password);
    const resolved = squarecoilResolveLatestFile_(jobNum, cookie);
    if (!resolved.success || !resolved.fileFound) return { available: false };
    const response = squarecoilGet_(
      'download_design_file.php?file_id=' + resolved.fileId + '&project_id=' + resolved.jobNum,
      cookie
    );
    const blob = response.getBlob();
    const bytes = blob.getBytes();
    if (response.getResponseCode() !== 200 || !squarecoilLooksLikePdf_(bytes)) return { available: false };
    cacheSquarecoilFile_(resolved, blob);
    return { available: true, name: resolved.fileName, base64: Utilities.base64Encode(bytes) };
  } catch (err) {
    console.warn('Squarecoil Production File lookup failed for %s: %s', jobNum, err && err.message);
    return { available: false };
  }
}

const SQUARECOIL_TRIGGER_HOURS_PROP = 'SQUARECOIL_TRIGGER_HOURS';

function scheduledSquarecoilFileRefresh() {
  try {
    const result = refreshSquarecoilProductionFiles();
    clearOperationalFailure('squarecoil-refresh');
    return result;
  } catch (err) {
    recordOperationalFailure('squarecoil-refresh', err);
    throw err;
  }
}

function ensureSquarecoilRefreshTrigger() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const current = triggers.filter(trigger => trigger.getHandlerFunction() === 'scheduledSquarecoilFileRefresh');
  const legacy = triggers.filter(trigger => ['refreshDropboxProofs', 'scheduledDropboxProofRefresh'].indexOf(trigger.getHandlerFunction()) !== -1);
  const scheduledHours = +(props.getProperty(SQUARECOIL_TRIGGER_HOURS_PROP) || 0);
  if (current.length === 1 && !legacy.length && scheduledHours === SQUARECOIL_FILES_REFRESH_HOURS) return;
  resetSquarecoilRefreshTrigger();
}

function resetSquarecoilRefreshTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => [
      'refreshDropboxProofs',
      'scheduledDropboxProofRefresh',
      'refreshSquarecoilProductionFiles',
      'scheduledSquarecoilFileRefresh',
    ].indexOf(trigger.getHandlerFunction()) !== -1)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('scheduledSquarecoilFileRefresh').timeBased().everyHours(SQUARECOIL_FILES_REFRESH_HOURS).create();
  PropertiesService.getScriptProperties().setProperty(SQUARECOIL_TRIGGER_HOURS_PROP, String(SQUARECOIL_FILES_REFRESH_HOURS));
  Logger.log('Squarecoil Production File refresh trigger set to every %s hour(s)', SQUARECOIL_FILES_REFRESH_HOURS);
}

// Existing installations may run one old handler before normal app traffic
// replaces its trigger. Keep these aliases source-safe during that migration.
function refreshDropboxProofs() { return refreshSquarecoilProductionFiles(); }
function scheduledDropboxProofRefresh() { return scheduledSquarecoilFileRefresh(); }
