// ── Calendar jobs ────────────────────────────────────────────────────────────
// The window the app itself always fetches when no from/to params are given.
function defaultCalendarWindow() {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 14);
  const end = new Date(now); end.setDate(end.getDate() + 90);
  return { start, end };
}

// CalendarApp.getEvents() is by far the slowest part of a request — two
// calendars over a ~104-day window can take several seconds, and every
// client requests the same default window (see defaultCalendarWindow()),
// so this is cached and shared across everyone hitting it rather than
// re-querying Calendar on every login/poll-triggered refresh. Deliberately
// doesn't cache getAllTracking() (completed/notes/checklists) alongside
// this — that needs to stay live since it reflects other users' edits in
// real time, and it's already cheap (one batched Sheets read, not a
// Calendar scan).
const CALENDAR_CACHE_TTL_SECONDS = 120;

function getCalendarJobs(start, end) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'caljobs_' + formatDate(start) + '_' + formatDate(end);
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* fall through to a live fetch */ }
  }

  const events = [
    ...fetchCalendarEvents(INSTALL_CAL_ID, start, end),
    ...fetchCalendarEvents(SUB_INSTALL_CAL_ID, start, end),
  ];
  const jobs = groupIntoJobs(events);

  try {
    cache.put(cacheKey, JSON.stringify(jobs), CALENDAR_CACHE_TTL_SECONDS);
  } catch (err) {
    // Payload over CacheService's 100KB-per-key limit — fine, this window
    // just won't be cached; every request still gets fresh, correct data.
  }

  return jobs;
}

function getProductionJobs(e, actor) {
  const params = (e && e.parameter) || {};
  const defaults = defaultCalendarWindow();
  let start, end;
  if (params.from) {
    const p = params.from.split('-');
    start = new Date(+p[0], +p[1] - 1, +p[2]);
  } else {
    start = defaults.start;
  }
  if (params.to) {
    const p = params.to.split('-');
    end = new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 59);
  } else {
    end = defaults.end;
  }

  let jobs = getCalendarJobs(start, end);
  const tracking = getAllTracking();

  jobs.forEach(job => {
    const t = tracking[job.jobKey] || {};
    job.completed = !!t.completed;
    job.notes = t.notes || [];
    job.completedAt = t.completedAt || '';
    job.completedBy = t.completedBy || '';
    // A manually-set due date wins over the calculated one, for one-off
    // scheduling edge cases the automatic 2-business-day rule gets wrong.
    job.autoDueDate = job.dueDate;
    job.dueOverride = t.dueOverride || '';
    if (job.dueOverride) job.dueDate = job.dueOverride;
    job.departments = t.departments || [];
    job.departmentChecklists = t.departmentChecklists || {};
    job.currentDepartments = t.currentDepartments || [];
    job.additionalFiles = additionalFilesForClient(t.additionalFiles);
    // The token a client echoes back on its next write (see setTracking's
    // expectedUpdatedAt check) so a save built from this snapshot gets
    // rejected if someone else's write landed first.
    job.updatedAt = t.updatedAt || '';
  });

  let handoffJobs = [];
  if (actor && canViewOtherProduction(actor.department)) {
    handoffJobs = squarecoilProjectHandoffJobs_();
    jobs = mergeProjectHandoffJobs_(jobs, handoffJobs, tracking);
  }

  // Production-department users (Manufacturing, Graphics, etc.) see every
  // job their department is ever assigned to, whether or not it's
  // currently their turn — including once they've finished their own
  // tasks, and even after the whole job is marked complete, so a job never
  // disappears out from under them. (This used to filter on
  // currentDepartments instead, which meant a job vanished the moment
  // their department's last task was checked off.) Everyone else (Admin,
  // Manager, Viewer) sees the full list regardless, including unassigned
  // jobs.
  if (actor && JOB_DEPARTMENTS.indexOf(actor.department) !== -1) {
    jobs = jobs.filter(job => job.departments.indexOf(actor.department) !== -1);
  }

  return { jobs, timestamp: new Date().toISOString(), fetchedFrom: formatDate(start), fetchedTo: formatDate(end), version: productionJobsVersion_(actor, handoffJobs) };
}

function otherProductionJob_(source, tracking) {
  const t = tracking || {};
  return {
    jobKey: source.jobNum,
    jobNum: source.jobNum,
    title: source.title,
    addr: source.addr || '',
    crew: [],
    startDate: '',
    endDate: '',
    dueDate: t.dueOverride || '',
    autoDueDate: '',
    dueOverride: t.dueOverride || '',
    multiDay: false,
    isOtherProduction: true,
    squarecoilStatus: source.squarecoilStatus || 'Project Handoff',
    completed: !!t.completed,
    completedAt: t.completedAt || '',
    completedBy: t.completedBy || '',
    notes: t.notes || [],
    departments: t.departments || [],
    departmentChecklists: t.departmentChecklists || {},
    currentDepartments: t.currentDepartments || [],
    additionalFiles: additionalFilesForClient(t.additionalFiles),
    updatedAt: t.updatedAt || '',
  };
}

function mergeProjectHandoffJobs_(calendarJobs, handoffJobs, tracking) {
  const scheduledJobNums = new Set((calendarJobs || []).map(job => String(job.jobNum || job.jobKey || '')));
  const otherJobs = (handoffJobs || [])
    .filter(job => !scheduledJobNums.has(String(job.jobNum || '')))
    .map(job => otherProductionJob_(job, (tracking || {})[String(job.jobNum)]));
  return (calendarJobs || []).concat(otherJobs);
}

function projectHandoffVersion_(handoffJobs) {
  return (handoffJobs || [])
    .map(job => [job.jobNum, job.title, job.addr, job.squarecoilStatus].join('~'))
    .sort()
    .join('|');
}

function productionJobsVersion_(actor, loadedHandoffJobs) {
  if (!actor || !canViewOtherProduction(actor.department)) return getTrackingVersion();
  const handoffJobs = loadedHandoffJobs || squarecoilProjectHandoffJobs_();
  return String(getTrackingVersion()) + ':' + projectHandoffVersion_(handoffJobs);
}

function isOtherProductionJob_(jobKey) {
  const value = String(jobKey || '');
  if (!validJobKey(value)) return false;
  const handoff = squarecoilProjectHandoffJobs_().some(job => job.jobNum === value);
  if (!handoff) return false;
  const window = defaultCalendarWindow();
  return !getCalendarJobs(window.start, window.end).some(job => job.jobNum === value);
}

function normalizeArchiveSnapshot(jobKey, value) {
  if (!value || String(value.jobNum || '') !== String(jobKey || '') || !validJobKey(jobKey)) return null;
  const bounded = (input, max) => String(input || '').trim().slice(0, max);
  const date = input => {
    const text = bounded(input, 10);
    return validDateOverride(text) ? text : '';
  };
  return {
    title: bounded(value.title, 300),
    addr: bounded(value.addr, 500),
    crew: Array.isArray(value.crew)
      ? value.crew.slice(0, 20).map(name => bounded(name, 80)).filter(Boolean)
      : [],
    startDate: date(value.startDate),
    endDate: date(value.endDate),
    dueDate: date(value.dueDate),
  };
}

function archiveJobFromTracking(jobKey, tracking) {
  const snapshot = tracking.archiveSnapshot || {};
  const startDate = snapshot.startDate || '';
  const endDate = snapshot.endDate || startDate;
  const dueDate = tracking.dueOverride || snapshot.dueDate || '';
  return {
    jobKey: String(jobKey),
    jobNum: String(jobKey),
    title: snapshot.title || 'Archived job ' + jobKey,
    addr: snapshot.addr || '',
    crew: snapshot.crew || [],
    startDate,
    endDate,
    dueDate,
    autoDueDate: snapshot.dueDate || '',
    dueOverride: tracking.dueOverride || '',
    multiDay: !!(startDate && endDate && startDate !== endDate),
    completed: true,
    completedAt: tracking.completedAt || '',
    completedBy: tracking.completedBy || '',
    notes: tracking.notes || [],
    checklist: tracking.checklist || [],
    departments: tracking.departments || [],
    departmentChecklists: tracking.departmentChecklists || {},
    currentDepartments: tracking.currentDepartments || [],
    additionalFiles: additionalFilesForClient(tracking.additionalFiles),
    updatedAt: tracking.updatedAt || '',
  };
}

function searchArchivedJobs(actor, query) {
  const text = String(query || '').trim();
  if (text.length > 80) return { error: 'Search is too long', jobs: [] };
  const needle = text.toLowerCase();
  const tracking = getAllTracking();
  const jobs = Object.keys(tracking)
    .filter(jobKey => {
      const record = tracking[jobKey];
      if (!record.completed) return false;
      if (actor && JOB_DEPARTMENTS.indexOf(actor.department) !== -1
          && (record.departments || []).indexOf(actor.department) === -1) return false;
      if (!needle) return true;
      const snapshot = record.archiveSnapshot || {};
      const taskText = Object.keys(record.departmentChecklists || {})
        .flatMap(department => (record.departmentChecklists[department] || []).map(item => item.text || ''));
      const searchable = [
        jobKey, snapshot.title || '', snapshot.addr || '', record.completedBy || '',
        ...(record.departments || []),
        ...(record.notes || []).flatMap(note => [note.text || '', note.author || '']),
        ...taskText,
      ].join('\n').toLowerCase();
      return searchable.indexOf(needle) !== -1;
    })
    .map(jobKey => archiveJobFromTracking(jobKey, tracking[jobKey]))
    .sort((a, b) => String(b.completedAt || b.updatedAt).localeCompare(String(a.completedAt || a.updatedAt)))
    .slice(0, 100);
  return { jobs };
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

    // (?<![A-Za-z]-) keeps permit codes like "SGNP-251421" from being
    // mistaken for job numbers, while "251257 & 260695" still matches both
    const jobNums = [...title.matchAll(/(?<![A-Za-z]-)\b(\d{5,6})\b/g)].map(m => m[1]);
    if (!jobNums.length || SKIP_KEYWORDS.some(k => titleLower.includes(k))) return;

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
    const dates = jobEvents.map(ev => ev.eventDate);
    const startDate = dates.reduce((a, b) => (b < a ? b : a));
    const endDate = dates.reduce((a, b) => (b > a ? b : a));
    const crew = [];
    jobEvents.forEach(ev => ev.crew.forEach(c => { if (!crew.includes(c)) crew.push(c); }));

    return {
      jobKey: jobNum,
      jobNum,
      title: jobEvents[0].title,
      addr: jobEvents[0].addr,
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
