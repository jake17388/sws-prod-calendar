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
  return { ok: true, user: user, token: makeToken(user) };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const UNAUTHORIZED = { error: 'unauthorized' };

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
    job.progressPct = job.checklist.length
      ? Math.round((job.checklist.filter(i => i.done).length / job.checklist.length) * 100)
      : null;
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
      // Case-sensitive on purpose: "REMOVAL" is the crew's convention for a
      // remove-only trip, distinct from mixed-case titles like "Remove and
      // Install" that describe the actual production visit.
      isRemoval: /\bREMOVAL\b/.test(title),
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
    // A remove-only trip (e.g. pulling a sign down for shop refurbishment)
    // shouldn't drive the production due date — that's set by the actual
    // install/reinstall visit. Only fall back to the removal date if
    // that's genuinely the only event this job number has.
    const nonRemoval = jobEvents.filter(ev => !ev.isRemoval);
    const dateSource = nonRemoval.length ? nonRemoval : jobEvents;

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
    ss.getActiveSheet().appendRow(['job_key', 'completed', 'notes', 'checklist_json', 'updated_at', 'updated_by', 'completed_at', 'completed_by']);
  }
  return ss.getActiveSheet();
}

function getAllTracking() {
  const sheet = getTrackingSheet();
  const data = sheet.getDataRange().getValues();
  const tracking = {};
  for (let i = 1; i < data.length; i++) {
    const [jobKey, completed, notes, checklistJson, , , completedAt, completedBy] = data[i];
    if (!jobKey) continue;
    let checklist = [];
    try { checklist = checklistJson ? JSON.parse(checklistJson) : []; } catch (err) { checklist = []; }
    tracking[String(jobKey)] = {
      completed: !!completed, notes: notes || '', checklist,
      completedAt: completedAt || '', completedBy: completedBy || '',
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
      ? { completed: false, notes: '', checklist: [], completedAt: '', completedBy: '' }
      : {
          completed: !!data[rowIndex - 1][1],
          notes: data[rowIndex - 1][2] || '',
          checklist: (() => { try { return JSON.parse(data[rowIndex - 1][3] || '[]'); } catch (e) { return []; } })(),
          completedAt: data[rowIndex - 1][6] || '',
          completedBy: data[rowIndex - 1][7] || '',
        };
    const next = { ...current, ...patch };
    // completedAt/completedBy only change on an actual complete/un-complete
    // toggle (patch.completed present) — editing notes or the checklist
    // shouldn't touch who/when it was marked done.
    if (patch.completed !== undefined) {
      next.completedAt = patch.completed ? new Date().toISOString() : '';
      next.completedBy = patch.completed ? user : '';
    }
    const row = [jobKey, next.completed, next.notes, JSON.stringify(next.checklist), new Date().toISOString(), user, next.completedAt, next.completedBy];
    if (rowIndex === -1) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    }
    const progressPct = next.checklist.length
      ? Math.round((next.checklist.filter(i => i.done).length / next.checklist.length) * 100)
      : null;
    return { success: true, ...next, progressPct };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}
