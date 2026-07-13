// ── Config ───────────────────────────────────────────────────────────────────
const INSTALL_CAL_ID = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SUB_INSTALL_CAL_ID = 'c_56442105e894ca5ed344bd94026279f754921d3ff42e0542c5d162f00c68ff07@group.calendar.google.com';

const SKIP_KEYWORDS = ['no install', 'hunter out', 'johnny out', 'randy off', 'jake out', 'eli out', 'crane service', '2018 crane', "mother's day", 'memorial day', 'holiday', 'independence day'];

const CREW_NAMES = ['Johnny', 'Jonathan', 'Randy', 'Eli', 'Jerry', 'Jake', 'Brian', 'Noe', 'Jason', 'Fernando', 'Canez'];
function normalizeCrew(names) {
  return names.map(n => {
    const match = CREW_NAMES.find(k => k.toLowerCase() === n.toLowerCase());
    return match || n;
  });
}

const DUE_DATE_BUSINESS_DAYS = 2;

// Names (must match a PIN's mapped name exactly) allowed to manually
// override a job's calculated due date for one-off scheduling edge cases.
// Add more names here and redeploy to grant the permission to others.
const DUE_DATE_EDITORS = ['Jake Banks'];

// ── Auth ─────────────────────────────────────────────────────────────────────
// PINs live in this project's own Script Properties, independent of
// sws-job-map's. Real values are never committed — see setPins() below.
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // sessions last 30 days
const MAX_PIN_FAILS = 10;                   // then logins lock for 10 minutes

// Placeholder only. To go live: paste the real PIN → name map here, run
// setPins() once from the Apps Script editor, then undo the edit so real
// PINs never land in git (same workflow as sws-job-map).
const DEFAULT_PINS = {
  '0000': 'Replace Me',
};

function setPins() {
  PropertiesService.getScriptProperties()
    .setProperty('PINS', JSON.stringify(DEFAULT_PINS));
}

function addPin(pin, user) {
  const pins = getPins();
  pins[String(pin)] = user;
  PropertiesService.getScriptProperties().setProperty('PINS', JSON.stringify(pins));
}

function getPins() {
  const props = PropertiesService.getScriptProperties();
  let pins = props.getProperty('PINS');
  if (!pins) {
    pins = JSON.stringify(DEFAULT_PINS);
    props.setProperty('PINS', pins);
  }
  return JSON.parse(pins);
}

function getAuthSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('AUTH_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', secret);
  }
  return secret;
}

function signPayload(payload) {
  const sig = Utilities.computeHmacSha256Signature(payload, getAuthSecret());
  return Utilities.base64EncodeWebSafe(sig);
}

function makeToken(user) {
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ u: user, e: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + signPayload(payload);
}

// Returns the user name for a valid unexpired token, else null
function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (signPayload(parts[0]) !== parts[1]) return null;
  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (err) { return null; }
  if (!data || !data.u || !data.e || data.e < Date.now()) return null;
  return data.u;
}

function checkPin(pin) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('pin_fails') || 0);
  if (fails >= MAX_PIN_FAILS) return { ok: false, locked: true };
  const user = getPins()[String(pin)];
  if (!user) {
    cache.put('pin_fails', String(fails + 1), 600);
    return { ok: false };
  }
  return { ok: true, user: user, token: makeToken(user), isDueDateEditor: DUE_DATE_EDITORS.indexOf(user) !== -1 };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const UNAUTHORIZED = { error: 'unauthorized' };

// ── Squarecoil integration ───────────────────────────────────────────────────
// Squarecoil (our PM software) has no public API — project pages are
// server-rendered PHP behind a plain session-cookie login. Credentials live
// in Script Properties, never committed — set once via
// setSquarecoilCredentials() from the Apps Script editor, same workflow as
// setPins() above.
const SQUARECOIL_BASE_URL = 'https://summitwestsigns.squarecoil.net';

function setSquarecoilCredentials(username, password) {
  PropertiesService.getScriptProperties()
    .setProperty('SQUARECOIL_CREDS', JSON.stringify({ username, password }));
}

function getSquarecoilCredentials() {
  const raw = PropertiesService.getScriptProperties().getProperty('SQUARECOIL_CREDS');
  if (!raw) throw new Error('Squarecoil credentials not set — run setSquarecoilCredentials() once from the Apps Script editor');
  return JSON.parse(raw);
}

// Cached briefly so repeated imports don't re-login every time; Squarecoil's
// own session timeout (not this cache) is what actually bounds its lifetime.
function getSquarecoilSessionCookie() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('squarecoil_session');
  if (cached) return cached;

  const { username, password } = getSquarecoilCredentials();

  // A fresh hit issues the PHPSESSID cookie before any login has happened —
  // the same cookie is then promoted to "authenticated" by the login POST.
  const initial = UrlFetchApp.fetch(`${SQUARECOIL_BASE_URL}/login.php?m=1`, { muteHttpExceptions: true });
  const cookie = extractSessionCookie(initial);
  if (!cookie) throw new Error('Squarecoil did not issue a session cookie');

  const loginResponse = UrlFetchApp.fetch(`${SQUARECOIL_BASE_URL}/login.php`, {
    method: 'post',
    payload: { action: '1', username, password, latlong: '', latlong_error: '', latitude: '', longitude: '' },
    headers: { Cookie: cookie },
    followRedirects: false,
    muteHttpExceptions: true,
  });
  if (loginResponse.getResponseCode() !== 302) throw new Error('Squarecoil login failed — check stored credentials');

  cache.put('squarecoil_session', cookie, 15 * 60);
  return cookie;
}

function extractSessionCookie(response) {
  const headers = response.getAllHeaders();
  const raw = headers['Set-Cookie'] || headers['set-cookie'];
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const sessionHeader = list.find(h => h.startsWith('PHPSESSID='));
  return sessionHeader ? sessionHeader.split(';')[0] : null;
}

function fetchScopeOfWork(jobNum) {
  const cookie = getSquarecoilSessionCookie();
  const response = UrlFetchApp.fetch(`${SQUARECOIL_BASE_URL}/project.php?id=${encodeURIComponent(jobNum)}`, {
    headers: { Cookie: cookie },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error(`Squarecoil returned HTTP ${response.getResponseCode()}`);
  return parseScopeOfWork(response.getContentText());
}

// Scope of Work lives in the project page's own <textarea name="description">
// (the source field behind its CKEditor) as raw HTML — one line item per
// "<spelled-out qty> (<digit qty>) <description>", separated by <br />.
// Section headers and notes ("Manufacture and install:", contract numbers,
// etc.) don't match that shape and are silently skipped.
function parseScopeOfWork(html) {
  const fieldMatch = html.match(/<textarea[^>]*name\s*=\s*"description"[^>]*>([\s\S]*?)<\/textarea>/i);
  if (!fieldMatch) return [];

  const lines = fieldMatch[1]
    .split(/<br\s*\/?>/i)
    .map(line => line.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').trim())
    .filter(Boolean);

  const items = [];
  lines.forEach(line => {
    const lineMatch = line.match(/^[A-Za-z]+\s*\((\d+)\)\s*(.+)$/);
    if (!lineMatch) return;
    items.push({ qtyTotal: +lineMatch[1], description: lineMatch[2].trim() });
  });
  return items;
}

// Merges freshly-scraped Scope of Work line items into the job's checklist.
// Matches against existing scope-derived items by description text so
// in-progress qtyDone counts survive a re-import; manually-added checklist
// items (no qtyTotal) are left untouched.
function importScopeOfWork(jobKey, user) {
  if (!jobKey) return { success: false, error: 'jobKey required' };

  let scopeItems;
  try {
    scopeItems = fetchScopeOfWork(jobKey);
  } catch (err) {
    return { success: false, error: err.message };
  }
  if (!scopeItems.length) return { success: false, error: 'No itemized Scope of Work lines found' };

  const tracking = getAllTracking();
  const existing = (tracking[String(jobKey)] || {}).checklist || [];

  const importedItems = scopeItems.map(item => {
    const match = existing.find(i => i.qtyTotal !== undefined
      && i.text.trim().toLowerCase() === item.description.trim().toLowerCase());
    const qtyDone = match ? Math.min(match.qtyDone || 0, item.qtyTotal) : 0;
    return {
      id: match ? match.id : Utilities.getUuid(),
      text: item.description,
      qtyTotal: item.qtyTotal,
      qtyDone,
      done: qtyDone >= item.qtyTotal,
    };
  });
  const manualItems = existing.filter(i => i.qtyTotal === undefined);

  return setTracking(jobKey, { checklist: [...importedItems, ...manualItems] }, user);
}

// Quantity-aware progress: scope-of-work items count qtyDone/qtyTotal,
// manually-added items count as a plain 1/0 — summed across all items so a
// job that's 9/18 done on one line and fully done on two others reflects
// that partial credit instead of jumping straight from 0% to 100%.
function computeProgressPct(checklist) {
  if (!checklist.length) return null;
  let total = 0, done = 0;
  checklist.forEach(i => {
    total += i.qtyTotal || 1;
    done += i.qtyTotal !== undefined ? (i.qtyDone || 0) : (i.done ? 1 : 0);
  });
  return total ? Math.round((done / total) * 100) : null;
}

// ── Routing ──────────────────────────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'getProductionJobs') {
    if (!verifyToken(e.parameter.token)) return json(UNAUTHORIZED);
    return json(getProductionJobs(e));
  }

  // The app itself is hosted on GitHub Pages, not here
  return ContentService.createTextOutput(
    'SWS Production Calendar: https://jake17388.github.io/sws-prod-calendar/');
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.action === 'login') {
    return json(checkPin(data.pin));
  }

  const user = verifyToken(data.token);
  if (!user) return json(UNAUTHORIZED);

  if (data.action === 'toggleComplete') {
    return json(setTracking(data.jobKey, { completed: !!data.completed }, user));
  }
  if (data.action === 'updateNotes') {
    return json(setTracking(data.jobKey, { notes: String(data.notes || '') }, user));
  }
  if (data.action === 'updateChecklist') {
    return json(setTracking(data.jobKey, { checklist: data.checklist || [] }, user));
  }
  if (data.action === 'importScopeOfWork') {
    return json(importScopeOfWork(data.jobKey, user));
  }
  if (data.action === 'updateDueDate') {
    if (DUE_DATE_EDITORS.indexOf(user) === -1) return json({ error: 'forbidden' });
    return json(setTracking(data.jobKey, { dueOverride: String(data.dueDate || '') }, user));
  }
  return json({ error: 'unknown action' });
}

// ── Calendar jobs ────────────────────────────────────────────────────────────
function getProductionJobs(e) {
  const params = (e && e.parameter) || {};
  const now = new Date();
  let start, end;
  if (params.from) {
    const p = params.from.split('-');
    start = new Date(+p[0], +p[1] - 1, +p[2]);
  } else {
    start = new Date(now); start.setDate(start.getDate() - 14);
  }
  if (params.to) {
    const p = params.to.split('-');
    end = new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 59);
  } else {
    end = new Date(now); end.setDate(end.getDate() + 90);
  }

  const events = [
    ...fetchCalendarEvents(INSTALL_CAL_ID, start, end),
    ...fetchCalendarEvents(SUB_INSTALL_CAL_ID, start, end),
  ];

  const jobs = groupIntoJobs(events);
  const tracking = getAllTracking();

  jobs.forEach(job => {
    const t = tracking[job.jobKey] || {};
    job.completed = !!t.completed;
    job.notes = t.notes || '';
    job.checklist = t.checklist || [];
    job.completedAt = t.completedAt || '';
    job.completedBy = t.completedBy || '';
    // A manually-set due date wins over the calculated one, for one-off
    // scheduling edge cases the automatic 2-business-day rule gets wrong.
    job.autoDueDate = job.dueDate;
    job.dueOverride = t.dueOverride || '';
    if (job.dueOverride) job.dueDate = job.dueOverride;
    job.progressPct = computeProgressPct(job.checklist);
  });

  return { jobs, timestamp: new Date().toISOString(), fetchedFrom: formatDate(start), fetchedTo: formatDate(end) };
}

// Parses raw calendar events into {title, addr, crew, jobNums[], eventDate}
// records. One record per calendar event — grouping into jobs happens in
// groupIntoJobs().
function fetchCalendarEvents(calId, start, end) {
  const cal = CalendarApp.getCalendarById(calId);
  if (!cal) return [];
  const events = cal.getEvents(start, end);
  const out = [];
  events.forEach(event => {
    const title = event.getTitle().trim();
    const titleLower = title.toLowerCase();
    if (SKIP_KEYWORDS.some(k => titleLower.includes(k))) return;

    // (?<![A-Za-z]-) keeps permit codes like "SGNP-251421" from being
    // mistaken for job numbers, while "251257 & 260695" still matches both
    const jobNums = [...title.matchAll(/(?<![A-Za-z]-)\b(\d{5,6})\b/g)].map(m => m[1]);
    const crewMatch = title.match(/^\(([^)]+)\)/);
    const crew = crewMatch
      ? normalizeCrew(crewMatch[1].split(/[\/,&]/).map(n => n.trim()).filter(n => n))
      : [];
    let cleanTitle = title
      .replace(/^\([^)]+\)\s*/, '')
      .replace(/(?<![A-Za-z]-)\b\d{5,6}\b\s*[-–]?\s*/g, '')
      .replace(/\s*&\s*/, ' ')
      .replace(/^\s*[-–]\s*/, '')
      .replace(/\(Day \d+\/\d+\)\s*$/i, '')
      .trim();
    const location = event.getLocation() ? event.getLocation().trim() : '';
    const cleanAddr = location.replace(/\s*\|\s*/g, ', ').replace(/\s+/g, ' ').trim();

    out.push({
      title: cleanTitle || title,
      addr: cleanAddr,
      crew,
      jobNums,
      eventDate: formatDate(event.getStartTime()),
      // Case-sensitive on purpose: all-caps "REMOVAL"/"SURVEY" are the crew's
      // convention for a non-production trip (remove-only or site survey),
      // distinct from mixed-case titles like "Remove and Install" that
      // describe the actual production visit.
      isNonProductionVisit: /\bREMOVAL\b|\bSURVEY\b/.test(title),
    });
  });
  return out;
}

// Groups per-day calendar events into one job record per job number.
// Multi-day jobs show up as separate events per day (often suffixed
// "(Day 1/2)"/"(Day 2/2)") sharing a job number. Events with no
// extractable job number (shop tasks like trailer service or oil
// changes, not production jobs) are dropped entirely. Events whose
// title contains more than one job number (e.g. "3 days 251257 &
// 260695 ...") are split into one job record per number, all sharing
// the event's data, and flagged for a manual look.
function groupIntoJobs(events) {
  const byJobNum = {};
  events.forEach(ev => {
    if (!ev.jobNums.length) return;
    ev.jobNums.forEach(jobNum => {
      (byJobNum[jobNum] = byJobNum[jobNum] || []).push({ ...ev, multiJobEvent: ev.jobNums.length > 1 });
    });
  });

  const jobs = Object.entries(byJobNum).map(([jobNum, jobEvents]) => {
    // A remove-only trip or a site survey (e.g. pulling a sign down for shop
    // refurbishment, or scoping a job before it's scheduled) shouldn't drive
    // the production due date — that's set by the actual install/reinstall
    // visit. Only fall back to these events if that's genuinely the only
    // event this job number has.
    const productionEvents = jobEvents.filter(ev => !ev.isNonProductionVisit);
    const dateSource = productionEvents.length ? productionEvents : jobEvents;

    const dates = dateSource.map(ev => ev.eventDate);
    const startDate = dates.reduce((a, b) => (b < a ? b : a));
    const endDate = dates.reduce((a, b) => (b > a ? b : a));
    const crew = [];
    dateSource.forEach(ev => ev.crew.forEach(c => { if (!crew.includes(c)) crew.push(c); }));

    return {
      jobKey: jobNum,
      jobNum,
      title: dateSource[0].title,
      addr: dateSource[0].addr,
      crew,
      startDate,
      endDate,
      multiJobEvent: jobEvents.some(ev => ev.multiJobEvent),
    };
  });

  jobs.forEach(job => {
    job.dueDate = formatDate(subtractBusinessDays(parseDate(job.startDate), DUE_DATE_BUSINESS_DAYS));
    job.multiDay = job.startDate !== job.endDate;
  });
  jobs.sort((a, b) => a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  return jobs;
}

function subtractBusinessDays(date, n) {
  const d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

function parseDate(iso) {
  const p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Sheets silently coerces date-shaped strings ("2026-08-15") written into a
// cell into an actual Date value, which comes back as a JS Date object
// (not the string we wrote) on the next read — normalize it back to plain
// YYYY-MM-DD regardless of which form the cell holds.
function normalizeDateCell(val) {
  if (!val) return '';
  return val instanceof Date ? formatDate(val) : String(val);
}

// ── Tracking (completed / notes / checklist) ────────────────────────────────
// Lazily creates its own spreadsheet on first use and remembers the ID in
// Script Properties, so there's no manual Sheet-ID setup step.
function getTrackingSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('TRACKING_SHEET_ID');
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('SWS Production Tracking');
    props.setProperty('TRACKING_SHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.appendRow(['job_key', 'completed', 'notes', 'checklist_json', 'updated_at', 'updated_by', 'completed_at', 'completed_by', 'due_override']);
    // Plain-text format on the date-shaped columns so Sheets doesn't
    // auto-coerce "2026-08-15" into an actual Date cell.
    sheet.getRange('G:I').setNumberFormat('@');
  }
  return ss.getActiveSheet();
}

function getAllTracking() {
  const sheet = getTrackingSheet();
  const data = sheet.getDataRange().getValues();
  const tracking = {};
  for (let i = 1; i < data.length; i++) {
    const [jobKey, completed, notes, checklistJson, , , completedAt, completedBy, dueOverride] = data[i];
    if (!jobKey) continue;
    let checklist = [];
    try { checklist = checklistJson ? JSON.parse(checklistJson) : []; } catch (err) { checklist = []; }
    tracking[String(jobKey)] = {
      completed: !!completed, notes: notes || '', checklist,
      completedAt: completedAt || '', completedBy: completedBy || '',
      dueOverride: normalizeDateCell(dueOverride),
    };
  }
  return tracking;
}

function setTracking(jobKey, patch, user) {
  if (!jobKey) return { success: false, error: 'jobKey required' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getTrackingSheet();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(jobKey)) { rowIndex = i + 1; break; }
    }
    const current = rowIndex === -1
      ? { completed: false, notes: '', checklist: [], completedAt: '', completedBy: '', dueOverride: '' }
      : {
          completed: !!data[rowIndex - 1][1],
          notes: data[rowIndex - 1][2] || '',
          checklist: (() => { try { return JSON.parse(data[rowIndex - 1][3] || '[]'); } catch (e) { return []; } })(),
          completedAt: data[rowIndex - 1][6] || '',
          completedBy: data[rowIndex - 1][7] || '',
          dueOverride: normalizeDateCell(data[rowIndex - 1][8]),
        };
    const next = { ...current, ...patch };
    // completedAt/completedBy only change on an actual complete/un-complete
    // toggle (patch.completed present) — editing notes or the checklist
    // shouldn't touch who/when it was marked done.
    if (patch.completed !== undefined) {
      next.completedAt = patch.completed ? new Date().toISOString() : '';
      next.completedBy = patch.completed ? user : '';
    }
    const row = [jobKey, next.completed, next.notes, JSON.stringify(next.checklist), new Date().toISOString(), user, next.completedAt, next.completedBy, next.dueOverride];
    if (rowIndex === -1) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    }
    return { success: true, ...next, progressPct: computeProgressPct(next.checklist) };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}
