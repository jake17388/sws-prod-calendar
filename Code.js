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

// ── Users & roles ────────────────────────────────────────────────────────────
// Each user is { id, name, department, pin } stored as one JSON array in the
// USERS Script Property. `id` is the durable identity a session token binds
// to — name and PIN are both editable from the in-app User Management
// screen, so auth and attribution can't depend on either staying fixed.
// Real names/PINs are never committed — see migrateLegacyPins() and
// defaultUsers() below.
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // sessions last 30 days
const MAX_PIN_FAILS = 10;                   // then logins lock for 10 minutes

const DEPARTMENTS = ['Admin', 'Manager', 'Viewer', 'Manufacturing', 'Graphics', 'Paint', 'Assembly', 'Letters', 'Routing'];

// Job-assignable tags — distinct from the user DEPARTMENTS list above.
// Ship-In isn't a role anyone logs in as; it's a job-only tag meaning "made
// elsewhere, just shipped in to us" rather than produced in one of our shops.
const JOB_DEPARTMENTS = ['Manufacturing', 'Graphics', 'Paint', 'Assembly', 'Letters', 'Routing'];
const JOB_TAGS = JOB_DEPARTMENTS.concat(['Ship-In']);

function canAssignDepartments(department) {
  return department === 'Admin' || department === 'Manager';
}

// Only Admin/Manager can mark an entire job complete. Production-department
// accounts complete their own tasks (see toggleDepartmentTaskDone), not the
// whole job; Viewers never complete anything.
function canMarkJobComplete(department) {
  return department === 'Admin' || department === 'Manager';
}

// Departments a Manager can't see in the user list at all.
const PM_HIDDEN_DEPARTMENTS = ['Admin', 'Viewer'];
// Departments a Manager can see but can't add/edit/delete — separate from
// PM_HIDDEN_DEPARTMENTS because a Manager *can* see fellow Managers, just
// not manage them.
const PM_BLOCKED_EDIT_DEPARTMENTS = ['Admin', 'Manager', 'Viewer'];

function canAccessUserManagement(department) {
  return department === 'Admin' || department === 'Manager';
}

// Whether a user in `actorDepartment` may add/edit/delete a user in
// `targetDepartment`. Admins can manage everyone; Managers can manage
// everyone except Admin/Manager/Viewer accounts; everyone else has no
// user-management access at all.
function canManageDepartment(actorDepartment, targetDepartment) {
  if (actorDepartment === 'Admin') return true;
  if (actorDepartment === 'Manager') return PM_BLOCKED_EDIT_DEPARTMENTS.indexOf(targetDepartment) === -1;
  return false;
}

function isLastAdmin(users, userId) {
  const admins = users.filter(u => u.department === 'Admin');
  return admins.length === 1 && admins[0].id === userId;
}

function visibleUsersFor(actor) {
  const users = getUsers();
  if (actor.department === 'Admin') return users;
  return users.filter(u => PM_HIDDEN_DEPARTMENTS.indexOf(u.department) === -1);
}

// Placeholder only, mirroring the old DEFAULT_PINS pattern — real users
// come from migrateLegacyPins() (see getUsers()) or get added through the
// in-app User Management screen. Never paste real PINs here.
function defaultUsers() {
  return [{ id: Utilities.getUuid(), name: 'Replace Me', department: 'Admin', pin: '0000' }];
}

// One-time upgrade path from the old flat PINS { pin: name } map: Jake
// Banks becomes the sole Admin, everyone else comes in as a Viewer,
// preserving whatever PINs are already live. Runs automatically the first
// time getUsers() finds no USERS property yet, so no manual step is needed.
function migrateLegacyPins() {
  const raw = PropertiesService.getScriptProperties().getProperty('PINS');
  if (!raw) return null;
  let legacy;
  try { legacy = JSON.parse(raw); } catch (err) { return null; }
  return Object.keys(legacy).map(pin => ({
    id: Utilities.getUuid(),
    name: legacy[pin],
    department: legacy[pin] === 'Jake Banks' ? 'Admin' : 'Viewer',
    pin: String(pin),
  }));
}

function getUsers() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('USERS');
  if (raw) {
    const users = JSON.parse(raw);
    if (renameLegacyManagerLabel(users)) saveUsers(users);
    return users;
  }
  const users = migrateLegacyPins() || defaultUsers();
  props.setProperty('USERS', JSON.stringify(users));
  return users;
}

// One-time rename: the "Production Manager" department became "Manager".
// Mutates in place and reports whether anything changed, so getUsers() only
// re-saves when there's actually a legacy value to fix — after the first
// read post-deploy this is a no-op.
function renameLegacyManagerLabel(users) {
  let changed = false;
  users.forEach(u => {
    if (u.department === 'Production Manager') { u.department = 'Manager'; changed = true; }
  });
  return changed;
}

function saveUsers(users) {
  PropertiesService.getScriptProperties().setProperty('USERS', JSON.stringify(users));
}

function validPin(pin) {
  return /^\d{4}$/.test(String(pin || ''));
}

function addUser(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  const name = String(data.name || '').trim();
  const department = String(data.department || '');
  const pin = String(data.pin || '');
  if (!name) return { success: false, error: 'Name is required' };
  if (DEPARTMENTS.indexOf(department) === -1) return { success: false, error: 'Invalid department' };
  if (!canManageDepartment(actor.department, department)) return { success: false, error: 'forbidden' };
  if (!validPin(pin)) return { success: false, error: 'PIN must be 4 digits' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    if (users.some(u => u.pin === pin)) return { success: false, error: 'That PIN is already in use' };
    const newUser = { id: Utilities.getUuid(), name, department, pin };
    users.push(newUser);
    saveUsers(users);
    return { success: true, user: newUser };
  } finally {
    lock.releaseLock();
  }
}

function updateUser(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    const idx = users.findIndex(u => u.id === data.id);
    if (idx === -1) return { success: false, error: 'User not found' };
    const target = users[idx];
    if (!canManageDepartment(actor.department, target.department)) return { success: false, error: 'forbidden' };

    const next = { ...target };
    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (!name) return { success: false, error: 'Name is required' };
      next.name = name;
    }
    if (data.department !== undefined) {
      if (DEPARTMENTS.indexOf(data.department) === -1) return { success: false, error: 'Invalid department' };
      if (!canManageDepartment(actor.department, data.department)) return { success: false, error: 'forbidden' };
      if (target.department === 'Admin' && data.department !== 'Admin' && isLastAdmin(users, target.id)) {
        return { success: false, error: "Can't remove the only Admin" };
      }
      next.department = data.department;
    }
    if (data.pin !== undefined) {
      const pin = String(data.pin);
      if (!validPin(pin)) return { success: false, error: 'PIN must be 4 digits' };
      if (users.some(u => u.id !== target.id && u.pin === pin)) return { success: false, error: 'That PIN is already in use' };
      next.pin = pin;
    }
    users[idx] = next;
    saveUsers(users);
    return { success: true, user: next };
  } finally {
    lock.releaseLock();
  }
}

function deleteUser(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    const idx = users.findIndex(u => u.id === data.id);
    if (idx === -1) return { success: false, error: 'User not found' };
    const target = users[idx];
    if (!canManageDepartment(actor.department, target.department)) return { success: false, error: 'forbidden' };
    if (isLastAdmin(users, target.id)) return { success: false, error: "Can't delete the only Admin" };
    users.splice(idx, 1);
    saveUsers(users);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// Lets any signed-in user change their own name/PIN, independent of
// canAccessUserManagement — this is how a Viewer (or a Manager, who can't
// edit their own Manager-department account through the department
// permission rules above) updates their own credentials. Deliberately
// ignores any `department` field so nobody can promote themselves.
function updateSelf(actor, data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    const idx = users.findIndex(u => u.id === actor.id);
    if (idx === -1) return { success: false, error: 'User not found' };
    const next = { ...users[idx] };
    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (!name) return { success: false, error: 'Name is required' };
      next.name = name;
    }
    if (data.pin !== undefined) {
      const pin = String(data.pin);
      if (!validPin(pin)) return { success: false, error: 'PIN must be 4 digits' };
      if (users.some(u => u.id !== next.id && u.pin === pin)) return { success: false, error: 'That PIN is already in use' };
      next.pin = pin;
    }
    users[idx] = next;
    saveUsers(users);
    return { success: true, user: next };
  } finally {
    lock.releaseLock();
  }
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

function makeToken(userId) {
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ uid: userId, e: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + signPayload(payload);
}

// Returns the user id for a valid unexpired token, else null. The token only
// carries an id, never a role — resolveActor() below looks up the current
// name/department fresh on every request, so a permission change or rename
// takes effect immediately without waiting for re-login.
function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (signPayload(parts[0]) !== parts[1]) return null;
  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (err) { return null; }
  if (!data || !data.uid || !data.e || data.e < Date.now()) return null;
  return data.uid;
}

// Resolves a token to the current { id, name, department, pin } record, or
// null if the token is invalid/expired/unsigned or the account behind it has
// since been deleted.
function resolveActor(token) {
  const uid = verifyToken(token);
  if (!uid) return null;
  return getUsers().find(u => u.id === uid) || null;
}

function checkPin(pin) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('pin_fails') || 0);
  if (fails >= MAX_PIN_FAILS) return { ok: false, locked: true };
  const user = getUsers().find(u => u.pin === String(pin));
  if (!user) {
    cache.put('pin_fails', String(fails + 1), 600);
    return { ok: false };
  }
  return {
    ok: true,
    user: user.name,
    department: user.department,
    token: makeToken(user.id),
    isDueDateEditor: DUE_DATE_EDITORS.indexOf(user.name) !== -1,
    canManageUsers: canAccessUserManagement(user.department),
  };
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
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    return json(getProductionJobs(e, actor));
  }
  if (action === 'getUsers') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    if (!canAccessUserManagement(actor.department)) return json({ error: 'forbidden' });
    return json({ users: visibleUsersFor(actor) });
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

  const actor = resolveActor(data.token);
  if (!actor) return json(UNAUTHORIZED);
  const user = actor.name;

  // Viewers are read-only against job state — they can look but not touch.
  if (data.action === 'updateNotes' && actor.department === 'Viewer') {
    return json({ error: 'forbidden' });
  }

  if (data.action === 'toggleComplete') {
    if (!canMarkJobComplete(actor.department)) return json({ error: 'forbidden' });
    return json(setTracking(data.jobKey, { completed: !!data.completed }, user));
  }
  if (data.action === 'updateNotes') {
    return json(setTracking(data.jobKey, { notes: String(data.notes || '') }, user));
  }
  if (data.action === 'updateDueDate') {
    if (DUE_DATE_EDITORS.indexOf(user) === -1) return json({ error: 'forbidden' });
    return json(setTracking(data.jobKey, { dueOverride: String(data.dueDate || '') }, user));
  }
  if (data.action === 'updateJobDepartments') return json(updateJobDepartments(actor, data));
  if (data.action === 'toggleDepartmentTaskDone') return json(toggleDepartmentTaskDone(actor, data));
  if (data.action === 'addUser') return json(addUser(actor, data));
  if (data.action === 'updateUser') return json(updateUser(actor, data));
  if (data.action === 'deleteUser') return json(deleteUser(actor, data));
  if (data.action === 'updateSelf') return json(updateSelf(actor, data));
  return json({ error: 'unknown action' });
}

// Stamps who/when completed a checklist item, based on whether `done` just
// transitioned from the previously-stored version — a text edit or an
// unrelated resync of an already-done item shouldn't overwrite who actually
// completed it. Un-checking clears the stamp, mirroring how the job-level
// completedAt/completedBy reset on un-complete.
function stampChecklistItem(nextItem, prevItem, actorName) {
  if (!nextItem.done) return { ...nextItem, doneBy: '', doneAt: '' };
  if (prevItem && prevItem.done) return { ...nextItem, doneBy: prevItem.doneBy || actorName, doneAt: prevItem.doneAt || new Date().toISOString() };
  return { ...nextItem, doneBy: actorName, doneAt: new Date().toISOString() };
}

// Only Admins and Managers can assign departments to a job. Any
// department not in JOB_TAGS is silently dropped rather than erroring, so a
// stale/typo'd tag from the client can't corrupt stored state. Checklist
// items are scoped per department — only departments actually being kept
// get their checklist carried over.
// `departments` is the full set of departments a job ever needs (drives the
// checklist sections). `currentDepartments` is a subset of that — whichever
// department(s) actually have the job right now; it's what a
// production-department account's calendar filters on and what the job-card
// badge shows, since a department not yet "current" doesn't need to see the
// job at all. Multiple departments can be current at once (parallel work),
// and there's deliberately no enforced order — Managers move it around
// however the actual workflow requires.
// Locked once the whole job is marked complete — reopen it (uncheck "Mark
// job complete") to edit departments again.
function updateJobDepartments(actor, data) {
  if (!canAssignDepartments(actor.department)) return { success: false, error: 'forbidden' };
  if (!data.jobKey) return { success: false, error: 'jobKey required' };

  const existing = getAllTracking()[String(data.jobKey)] || { completed: false, departmentChecklists: {} };
  if (existing.completed) return { success: false, error: 'Job is complete — reopen it to edit departments' };

  const departments = Array.isArray(data.departments)
    ? data.departments.filter(d => JOB_TAGS.indexOf(d) !== -1)
    : [];
  const currentDepartments = Array.isArray(data.currentDepartments)
    ? data.currentDepartments.filter(d => departments.indexOf(d) !== -1)
    : [];

  const departmentChecklists = {};
  const rawChecklists = (data.departmentChecklists && typeof data.departmentChecklists === 'object') ? data.departmentChecklists : {};
  departments.forEach(dept => {
    const items = Array.isArray(rawChecklists[dept]) ? rawChecklists[dept] : [];
    const oldItems = existing.departmentChecklists[dept] || [];
    departmentChecklists[dept] = items
      .map(i => {
        const id = String((i && i.id) || Utilities.getUuid());
        const text = String((i && i.text) || '').trim();
        const done = !!(i && i.done);
        const oldItem = oldItems.find(o => o.id === id);
        return stampChecklistItem({ id, text, done }, oldItem, actor.name);
      })
      .filter(i => i.text);
  });

  return setTracking(data.jobKey, { departments, departmentChecklists, currentDepartments }, actor.name);
}

// A production-department account (Manufacturing, Graphics, etc.) can only
// toggle the done state of an existing task in its OWN department's
// checklist — never another department's, never add/remove/retext items,
// and never touch which departments are assigned or current. That's
// deliberately narrower than updateJobDepartments (Admin/Manager) so a
// lower-privilege client can't smuggle in unrelated changes through this
// endpoint. Requires the department to be *current*, not just assigned —
// matches the calendar filter, so a department whose turn has passed can't
// keep editing a job it can no longer even see. Also locked once the whole
// job is marked complete.
function toggleDepartmentTaskDone(actor, data) {
  const department = String(data.department || '');
  if (JOB_DEPARTMENTS.indexOf(department) === -1 || actor.department !== department) {
    return { success: false, error: 'forbidden' };
  }
  if (!data.jobKey) return { success: false, error: 'jobKey required' };

  const tracking = getAllTracking();
  const current = tracking[String(data.jobKey)] || { completed: false, departments: [], departmentChecklists: {}, currentDepartments: [] };
  if (current.completed) return { success: false, error: 'Job is complete — reopen it to edit departments' };
  if (current.currentDepartments.indexOf(department) === -1) return { success: false, error: 'Not currently your department\'s job' };

  const itemId = String(data.itemId || '');
  const items = current.departmentChecklists[department] || [];
  const prevItem = items.find(i => i.id === itemId);
  const updatedItems = items.map(i => (i.id === itemId ? stampChecklistItem({ ...i, done: !!data.done }, prevItem, actor.name) : i));
  const departmentChecklists = { ...current.departmentChecklists, [department]: updatedItems };

  return setTracking(data.jobKey, { departmentChecklists }, actor.name);
}

// ── Calendar jobs ────────────────────────────────────────────────────────────
// The window the app itself always fetches when no from/to params are given.
function defaultCalendarWindow() {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 14);
  const end = new Date(now); end.setDate(end.getDate() + 90);
  return { start, end };
}

function getCalendarJobs(start, end) {
  const events = [
    ...fetchCalendarEvents(INSTALL_CAL_ID, start, end),
    ...fetchCalendarEvents(SUB_INSTALL_CAL_ID, start, end),
  ];
  return groupIntoJobs(events);
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
    job.notes = t.notes || '';
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
  });

  // Production-department users (Manufacturing, Graphics, etc.) only see a
  // job while it's actually their turn — everyone else (Admin, Manager,
  // Viewer) sees the full list, including unassigned jobs.
  if (actor && JOB_DEPARTMENTS.indexOf(actor.department) !== -1) {
    jobs = jobs.filter(job => job.currentDepartments.indexOf(actor.department) !== -1);
  }

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
    sheet.appendRow(['job_key', 'completed', 'notes', 'checklist_json', 'updated_at', 'updated_by', 'completed_at', 'completed_by', 'due_override', 'departments_json', 'department_checklists_json', 'current_departments_json']);
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
    const [jobKey, completed, notes, checklistJson, , , completedAt, completedBy, dueOverride, departmentsJson, departmentChecklistsJson, currentDepartmentsJson] = data[i];
    if (!jobKey) continue;
    let checklist = [];
    try { checklist = checklistJson ? JSON.parse(checklistJson) : []; } catch (err) { checklist = []; }
    let departments = [];
    try { departments = departmentsJson ? JSON.parse(departmentsJson) : []; } catch (err) { departments = []; }
    let departmentChecklists = {};
    try { departmentChecklists = departmentChecklistsJson ? JSON.parse(departmentChecklistsJson) : {}; } catch (err) { departmentChecklists = {}; }
    let currentDepartments = [];
    try { currentDepartments = currentDepartmentsJson ? JSON.parse(currentDepartmentsJson) : []; } catch (err) { currentDepartments = []; }
    tracking[String(jobKey)] = {
      completed: !!completed, notes: notes || '', checklist,
      completedAt: completedAt || '', completedBy: completedBy || '',
      dueOverride: normalizeDateCell(dueOverride),
      departments, departmentChecklists, currentDepartments,
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
      ? { completed: false, notes: '', checklist: [], completedAt: '', completedBy: '', dueOverride: '', departments: [], departmentChecklists: {}, currentDepartments: [] }
      : {
          completed: !!data[rowIndex - 1][1],
          notes: data[rowIndex - 1][2] || '',
          checklist: (() => { try { return JSON.parse(data[rowIndex - 1][3] || '[]'); } catch (e) { return []; } })(),
          completedAt: data[rowIndex - 1][6] || '',
          completedBy: data[rowIndex - 1][7] || '',
          dueOverride: normalizeDateCell(data[rowIndex - 1][8]),
          departments: (() => { try { return JSON.parse(data[rowIndex - 1][9] || '[]'); } catch (e) { return []; } })(),
          departmentChecklists: (() => { try { return JSON.parse(data[rowIndex - 1][10] || '{}'); } catch (e) { return {}; } })(),
          currentDepartments: (() => { try { return JSON.parse(data[rowIndex - 1][11] || '[]'); } catch (e) { return []; } })(),
        };
    const next = { ...current, ...patch };
    // completedAt/completedBy only change on an actual complete/un-complete
    // toggle (patch.completed present) — editing notes or the checklist
    // shouldn't touch who/when it was marked done.
    if (patch.completed !== undefined) {
      next.completedAt = patch.completed ? new Date().toISOString() : '';
      next.completedBy = patch.completed ? user : '';
    }
    const row = [jobKey, next.completed, next.notes, JSON.stringify(next.checklist), new Date().toISOString(), user, next.completedAt, next.completedBy, next.dueOverride, JSON.stringify(next.departments), JSON.stringify(next.departmentChecklists), JSON.stringify(next.currentDepartments)];
    if (rowIndex === -1) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    }
    return { success: true, ...next };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

