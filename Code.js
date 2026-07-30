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

// Where job folders live in the company Dropbox — see the Dropbox proofs
// section below. Job folders (e.g. "251509_Laveen Traditional Academy -
// EMC's") sit inside numbered range subfolders under this path.
const DROPBOX_ORDERS_PATH = '/Summit West Signs Team Folder/01 Orders';
const DROPBOX_PROOFS_REFRESH_HOURS = 1;

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

// A single incrementing counter, bumped on every successful tracking write
// (see setTracking()). Lets clients poll a one-Property read to know
// whether anything changed, instead of re-fetching the full job list (which
// re-hits CalendarApp + the tracking Sheet) on every poll tick.
function getTrackingVersion() {
  const v = PropertiesService.getScriptProperties().getProperty('TRACKING_VERSION');
  return v ? +v : 0;
}
function bumpTrackingVersion() {
  const props = PropertiesService.getScriptProperties();
  const next = (+(props.getProperty('TRACKING_VERSION') || 0)) + 1;
  props.setProperty('TRACKING_VERSION', String(next));
  return next;
}

// ── Routing ──────────────────────────────────────────────────────────────────
function doGet(e) {
  // Dropbox's OAuth redirect lands here with no `action` of ours — it's
  // e.parameter.code/state instead. Must be checked before action routing.
  if (e.parameter.code && e.parameter.state) {
    return handleDropboxOAuthCallback(e, ScriptApp.getService().getUrl());
  }

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
  if (action === 'getTrackingVersion') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    return json({ version: getTrackingVersion() });
  }
  if (action === 'getProofFile') {
    const actor = resolveActor(e.parameter.token);
    if (!actor) return json(UNAUTHORIZED);
    return json(getDropboxProofFile(String(e.parameter.jobNum || '')));
  }
  if (action === 'getDropboxStatus') {
    const actor = resolveActor(e.parameter.token);
    if (!actor || actor.department !== 'Admin') return json(UNAUTHORIZED);
    return json({ connected: isDropboxConnected(), hasCredentials: !!dropboxCredentials().appKey });
  }
  if (action === 'getDropboxAuthUrl') {
    const actor = resolveActor(e.parameter.token);
    if (!actor || actor.department !== 'Admin') return json(UNAUTHORIZED);
    const url = dropboxAuthUrl(ScriptApp.getService().getUrl());
    if (!url) return json({ error: 'App key/secret not set yet' });
    return json({ url });
  }
  if (action === 'debugDropboxProof') {
    const actor = resolveActor(e.parameter.token);
    if (!actor || actor.department !== 'Admin') return json(UNAUTHORIZED);
    return json(debugFindLatestProof(String(e.parameter.jobNum || '')));
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
    const result = setTracking(data.jobKey, { completed: !!data.completed }, user);
    // Completed jobs don't need to stay instantly available for a dozen
    // people at once — drop the pre-fetched copy the moment it's marked
    // done so storage doesn't accumulate; the proof still works, it just
    // falls back to a live Dropbox fetch (see getDropboxProofFile).
    if (result.success && data.completed && isDropboxConnected()) {
      try { evictProofCache(data.jobKey); } catch (err) { /* best-effort */ }
    }
    return json(result);
  }
  if (data.action === 'updateNotes') {
    return json(setTracking(data.jobKey, { notes: String(data.notes || '') }, user, data.expectedUpdatedAt));
  }
  if (data.action === 'updateDueDate') {
    if (DUE_DATE_EDITORS.indexOf(user) === -1) return json({ error: 'forbidden' });
    return json(setTracking(data.jobKey, { dueOverride: String(data.dueDate || '') }, user));
  }
  if (data.action === 'updateJobDepartments') return json(updateJobDepartments(actor, data));
  if (data.action === 'toggleDepartmentTaskDone') return json(toggleDepartmentTaskDone(actor, data));
  if (data.action === 'updateDepartmentNotes') return json(updateDepartmentNotes(actor, data));
  if (data.action === 'addUser') return json(addUser(actor, data));
  if (data.action === 'updateUser') return json(updateUser(actor, data));
  if (data.action === 'deleteUser') return json(deleteUser(actor, data));
  if (data.action === 'updateSelf') return json(updateSelf(actor, data));
  if (data.action === 'setDropboxCredentials') {
    if (actor.department !== 'Admin') return json({ error: 'forbidden' });
    const props = PropertiesService.getScriptProperties();
    props.setProperty('DROPBOX_APP_KEY', String(data.appKey || '').trim());
    props.setProperty('DROPBOX_APP_SECRET', String(data.appSecret || '').trim());
    return json({ success: true });
  }
  if (data.action === 'disconnectDropbox') {
    if (actor.department !== 'Admin') return json({ error: 'forbidden' });
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('DROPBOX_REFRESH_TOKEN');
    CacheService.getScriptCache().remove('dropbox_access_token');
    return json({ success: true });
  }
  if (data.action === 'refreshDropboxProofsNow') {
    if (actor.department !== 'Admin') return json({ error: 'forbidden' });
    if (!isDropboxConnected()) return json({ success: false, error: 'Dropbox not connected' });
    try {
      refreshDropboxProofs();
    } catch (err) {
      return json({ success: false, error: err.message });
    }
    return json({ success: true });
  }
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

  const existing = getAllTracking()[String(data.jobKey)] || { completed: false, departmentChecklists: {}, departmentNotes: {} };
  if (existing.completed) return { success: false, error: 'Job is complete — reopen it to edit departments' };

  const departments = Array.isArray(data.departments)
    ? data.departments.filter(d => JOB_TAGS.indexOf(d) !== -1)
    : [];
  const rawCurrentDepartments = Array.isArray(data.currentDepartments)
    ? data.currentDepartments.filter(d => departments.indexOf(d) !== -1)
    : [];

  // A Manager can't undo a completed task's done state or delete it — only
  // an Admin can, so the paper trail of who completed what and when can't
  // be erased. Mirrored client-side in renderEditableChecklist (which
  // hides/disables those controls so a Manager doesn't even see the
  // option), but enforced here as the actual source of truth.
  const isAdmin = actor.department === 'Admin';

  const departmentChecklists = {};
  const rawChecklists = (data.departmentChecklists && typeof data.departmentChecklists === 'object') ? data.departmentChecklists : {};
  departments.forEach(dept => {
    const items = Array.isArray(rawChecklists[dept]) ? rawChecklists[dept] : [];
    const oldItems = existing.departmentChecklists[dept] || [];
    const incomingById = new Map();
    let nextItems = items
      .map(i => {
        const id = String((i && i.id) || Utilities.getUuid());
        const text = String((i && i.text) || '').trim();
        const done = !!(i && i.done);
        const oldItem = oldItems.find(o => o.id === id);
        const built = stampChecklistItem({ id, text, done }, oldItem, actor.name);
        incomingById.set(id, built);
        return built;
      })
      .filter(i => i.text);

    if (!isAdmin) {
      oldItems.forEach(oldItem => {
        if (!oldItem.done) return;
        const incoming = incomingById.get(oldItem.id);
        if (!incoming || !incoming.done) {
          // Un-checked or deleted by a non-Admin — put it back exactly as
          // it was, dropping whatever the incoming payload tried to do to it.
          nextItems = nextItems.filter(i => i.id !== oldItem.id);
          nextItems.push(oldItem);
        }
      });
    }

    departmentChecklists[dept] = nextItems;
  });

  // A department can only be "currently" holding the job while it has an
  // open (not-done) task — Ship-In is the one exception, since it has no
  // checklist-driven workflow of its own (see renderDepartmentEditor's
  // self-heal comment). This both rejects a client trying to mark a
  // department current with no open tasks, and auto-drops a department the
  // moment its last open task on this very save gets checked off — a
  // Manager/Admin has to hand it back with a fresh task, rather than it
  // silently sitting "current" forever with nothing left to do.
  const currentDepartments = rawCurrentDepartments.filter(dept =>
    dept === 'Ship-In' || (departmentChecklists[dept] || []).some(i => !i.done));

  // Carries forward each kept department's notes (written through the
  // separate updateDepartmentNotes action below) and drops any belonging to
  // a department no longer assigned — same "only kept departments survive"
  // rule as departmentChecklists above.
  const departmentNotes = {};
  const oldNotes = existing.departmentNotes || {};
  departments.forEach(dept => {
    if (oldNotes[dept] !== undefined) departmentNotes[dept] = oldNotes[dept];
  });

  return setTracking(data.jobKey, { departments, departmentChecklists, currentDepartments, departmentNotes }, actor.name, data.expectedUpdatedAt);
}

// Free-text notes scoped to one department tag on one job. Admin/Manager can
// leave a note on any JOB_TAGS entry (including Ship-In, which has no
// logged-in role); a production-department account can only edit its own
// department's note, and only while that department is current — the same
// gate as toggleDepartmentTaskDone, since that's the only time it can see
// the job at all.
function updateDepartmentNotes(actor, data) {
  const department = String(data.department || '');
  if (JOB_TAGS.indexOf(department) === -1) return { success: false, error: 'forbidden' };

  const isManager = canAssignDepartments(actor.department);
  const isOwnDept = actor.department === department;
  if (!isManager && !isOwnDept) return { success: false, error: 'forbidden' };
  if (!data.jobKey) return { success: false, error: 'jobKey required' };

  const tracking = getAllTracking();
  const current = tracking[String(data.jobKey)] || { completed: false, departments: [], currentDepartments: [], departmentNotes: {} };
  if (current.completed) return { success: false, error: 'Job is complete — reopen it to edit notes' };
  if (!isManager && current.currentDepartments.indexOf(department) === -1) {
    return { success: false, error: "Not currently your department's job" };
  }

  const departmentNotes = { ...current.departmentNotes, [department]: String(data.notes || '') };
  return setTracking(data.jobKey, { departmentNotes }, actor.name, data.expectedUpdatedAt);
}

// A production-department account (Manufacturing, Graphics, etc.) can only
// toggle the done state of an existing task in its OWN department's
// checklist — never another department's, never add/remove/retext items,
// and never touch which departments are assigned or current. That's
// deliberately narrower than updateJobDepartments (Admin/Manager) so a
// lower-privilege client can't smuggle in unrelated changes through this
// endpoint. Requires the department to be *assigned* to the job (not
// necessarily current — a job stays visible and workable for a department
// the whole time it's assigned, see getProductionJobs). Checking a task off
// is always allowed; un-checking one is only allowed for whoever completed
// it — otherwise one department member could erase a teammate's completed
// record. Also locked once the whole job is marked complete.
function toggleDepartmentTaskDone(actor, data) {
  const department = String(data.department || '');
  if (JOB_DEPARTMENTS.indexOf(department) === -1 || actor.department !== department) {
    return { success: false, error: 'forbidden' };
  }
  if (!data.jobKey) return { success: false, error: 'jobKey required' };

  const tracking = getAllTracking();
  const current = tracking[String(data.jobKey)] || { completed: false, departments: [], departmentChecklists: {}, currentDepartments: [] };
  if (current.completed) return { success: false, error: 'Job is complete — reopen it to edit departments' };
  if (current.departments.indexOf(department) === -1) return { success: false, error: 'Not your department\'s job' };

  const itemId = String(data.itemId || '');
  const items = current.departmentChecklists[department] || [];
  const prevItem = items.find(i => i.id === itemId);
  if (!prevItem) return { success: false, error: 'Task not found' };

  const requestedDone = !!data.done;
  if (prevItem.done && !requestedDone && prevItem.doneBy !== actor.name) {
    return { success: false, error: 'Only the person who completed this task can un-check it' };
  }

  const updatedItems = items.map(i => (i.id === itemId ? stampChecklistItem({ ...i, done: requestedDone }, prevItem, actor.name) : i));
  const departmentChecklists = { ...current.departmentChecklists, [department]: updatedItems };

  // Checking off the last open task hands the department back — it's no
  // longer "currently" holding the job, so a Manager/Admin has to reassign
  // it once there's a new open task rather than it silently sitting
  // "current" forever with nothing left to do. Same rule
  // updateJobDepartments enforces for the Admin/Manager editor.
  const patch = { departmentChecklists };
  if (updatedItems.length && updatedItems.every(i => i.done)) {
    patch.currentDepartments = current.currentDepartments.filter(d => d !== department);
  }

  return setTracking(data.jobKey, patch, actor.name);
}

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
    job.departmentNotes = t.departmentNotes || {};
    // The token a client echoes back on its next write (see setTracking's
    // expectedUpdatedAt check) so a save built from this snapshot gets
    // rejected if someone else's write landed first.
    job.updatedAt = t.updatedAt || '';
  });

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

  return { jobs, timestamp: new Date().toISOString(), fetchedFrom: formatDate(start), fetchedTo: formatDate(end), version: getTrackingVersion() };
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
// Script Properties, so there's no manual Sheet-ID setup step. Shared with
// the Dropbox proofs cache below (a second tab in the same spreadsheet)
// rather than a separate file, so there's still only one Sheet-ID to manage.
function getTrackingSpreadsheet() {
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
    sheet.appendRow(['job_key', 'completed', 'notes', 'checklist_json', 'updated_at', 'updated_by', 'completed_at', 'completed_by', 'due_override', 'departments_json', 'department_checklists_json', 'current_departments_json', 'department_notes_json']);
    // Plain-text format on the date-shaped columns so Sheets doesn't
    // auto-coerce "2026-08-15" into an actual Date cell.
    sheet.getRange('G:I').setNumberFormat('@');
  }
  return ss;
}

function getTrackingSheet() {
  return getTrackingSpreadsheet().getSheets()[0];
}

function getAllTracking() {
  const sheet = getTrackingSheet();
  const data = sheet.getDataRange().getValues();
  const tracking = {};
  for (let i = 1; i < data.length; i++) {
    const [jobKey, completed, notes, checklistJson, updatedAt, , completedAt, completedBy, dueOverride, departmentsJson, departmentChecklistsJson, currentDepartmentsJson, departmentNotesJson] = data[i];
    if (!jobKey) continue;
    // A duplicate job_key row (see dedupeTrackingSheet) must resolve the
    // same way setTracking's own row-finder does — first occurrence wins —
    // or a write to the first row can silently get overwritten right back
    // by a stale second row on the very next read.
    if (Object.prototype.hasOwnProperty.call(tracking, String(jobKey))) continue;
    let checklist = [];
    try { checklist = checklistJson ? JSON.parse(checklistJson) : []; } catch (err) { checklist = []; }
    let departments = [];
    try { departments = departmentsJson ? JSON.parse(departmentsJson) : []; } catch (err) { departments = []; }
    let departmentChecklists = {};
    try { departmentChecklists = departmentChecklistsJson ? JSON.parse(departmentChecklistsJson) : {}; } catch (err) { departmentChecklists = {}; }
    let currentDepartments = [];
    try { currentDepartments = currentDepartmentsJson ? JSON.parse(currentDepartmentsJson) : []; } catch (err) { currentDepartments = []; }
    let departmentNotes = {};
    try { departmentNotes = departmentNotesJson ? JSON.parse(departmentNotesJson) : {}; } catch (err) { departmentNotes = {}; }
    tracking[String(jobKey)] = {
      completed: !!completed, notes: notes || '', checklist,
      updatedAt: updatedAt || '',
      completedAt: completedAt || '', completedBy: completedBy || '',
      dueOverride: normalizeDateCell(dueOverride),
      departments, departmentChecklists, currentDepartments, departmentNotes,
    };
  }
  return tracking;
}

// One-time cleanup for duplicate job_key rows already in the sheet (e.g.
// job 260162 had two — a fresh "completed" row and a stale leftover
// "incomplete" one, which kept clobbering the fresh one back on every
// read; see getAllTracking's comment for the read-side fix). Keeps the
// first occurrence of each job_key — same resolution order setTracking's
// row-finder and getAllTracking both use — and deletes the rest. Not
// wired to any UI action; run manually from the Apps Script editor
// (Run > dedupeTrackingSheet) if duplicates are ever suspected again.
// Logs how many rows it removed.
function dedupeTrackingSheet() {
  const sheet = getTrackingSheet();
  const data = sheet.getDataRange().getValues();
  const seen = new Set();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const jobKey = String(data[i][0]);
    if (!jobKey) continue;
    if (seen.has(jobKey)) {
      rowsToDelete.push(i + 1);
    } else {
      seen.add(jobKey);
    }
  }
  // Delete bottom-up so earlier row indexes stay valid as rows shift up.
  rowsToDelete.sort((a, b) => b - a).forEach(rowIndex => sheet.deleteRow(rowIndex));
  Logger.log('Removed %s duplicate row(s)', rowsToDelete.length);
  return rowsToDelete.length;
}

// `expectedUpdatedAt`, when passed, is the updatedAt the caller last read
// this job at. Callers that submit a full-replace patch (notes text, the
// whole departmentChecklists object) get rejected with a 'conflict' if
// someone else's write landed first — otherwise their patch, built from a
// stale local copy, would silently drop the other person's change even
// though this write is itself safely serialized by the lock below. Callers
// that only flip a single field (toggleComplete, toggleDepartmentTaskDone)
// don't need this — `current` below is always re-read fresh under the lock,
// so a single-field patch can never clobber unrelated concurrent changes.
function setTracking(jobKey, patch, user, expectedUpdatedAt) {
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
      ? { completed: false, notes: '', checklist: [], updatedAt: '', completedAt: '', completedBy: '', dueOverride: '', departments: [], departmentChecklists: {}, currentDepartments: [], departmentNotes: {} }
      : {
          completed: !!data[rowIndex - 1][1],
          notes: data[rowIndex - 1][2] || '',
          checklist: (() => { try { return JSON.parse(data[rowIndex - 1][3] || '[]'); } catch (e) { return []; } })(),
          updatedAt: data[rowIndex - 1][4] || '',
          completedAt: data[rowIndex - 1][6] || '',
          completedBy: data[rowIndex - 1][7] || '',
          dueOverride: normalizeDateCell(data[rowIndex - 1][8]),
          departments: (() => { try { return JSON.parse(data[rowIndex - 1][9] || '[]'); } catch (e) { return []; } })(),
          departmentChecklists: (() => { try { return JSON.parse(data[rowIndex - 1][10] || '{}'); } catch (e) { return {}; } })(),
          currentDepartments: (() => { try { return JSON.parse(data[rowIndex - 1][11] || '[]'); } catch (e) { return []; } })(),
          departmentNotes: (() => { try { return JSON.parse(data[rowIndex - 1][12] || '{}'); } catch (e) { return {}; } })(),
        };

    if (expectedUpdatedAt && rowIndex !== -1 && current.updatedAt && expectedUpdatedAt !== current.updatedAt) {
      return { success: false, error: 'conflict', ...current };
    }

    const next = { ...current, ...patch };
    // completedAt/completedBy only change on an actual complete/un-complete
    // toggle (patch.completed present) — editing notes or the checklist
    // shouldn't touch who/when it was marked done.
    if (patch.completed !== undefined) {
      next.completedAt = patch.completed ? new Date().toISOString() : '';
      next.completedBy = patch.completed ? user : '';
    }
    next.updatedAt = new Date().toISOString();
    const row = [jobKey, next.completed, next.notes, JSON.stringify(next.checklist), next.updatedAt, user, next.completedAt, next.completedBy, next.dueOverride, JSON.stringify(next.departments), JSON.stringify(next.departmentChecklists), JSON.stringify(next.currentDepartments), JSON.stringify(next.departmentNotes)];
    if (rowIndex === -1) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    }
    bumpTrackingVersion();
    return { success: true, ...next };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ── Dropbox proofs ───────────────────────────────────────────────────────────
// Matches each job's Dropbox folder by job number (under DROPBOX_ORDERS_PATH)
// and caches the path to the newest PDF in its Proofs subfolder, so opening
// a job in the app is instant — the folder search itself only runs on a
// time-driven trigger (see ensureDropboxRefreshTrigger), never per-request.
// The actual PDF bytes are fetched live, on demand, only when someone opens
// a job's Proof section — that's a single small download, not worth caching
// against the cache's freshness.
//
// Connected once from Settings (Admin only) via a standard OAuth2
// authorization-code flow requesting offline access, so the refresh token
// it returns keeps working indefinitely without the Admin re-approving.

function dropboxCredentials() {
  const props = PropertiesService.getScriptProperties();
  return {
    appKey: props.getProperty('DROPBOX_APP_KEY') || '',
    appSecret: props.getProperty('DROPBOX_APP_SECRET') || '',
    refreshToken: props.getProperty('DROPBOX_REFRESH_TOKEN') || '',
  };
}

function isDropboxConnected() {
  const c = dropboxCredentials();
  return !!(c.appKey && c.appSecret && c.refreshToken);
}

// Dropbox access tokens last ~4 hours — cached under that so a proof-file
// request doesn't pay for a token refresh round-trip every time.
function getDropboxAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dropbox_access_token');
  if (cached) return cached;

  const { appKey, appSecret, refreshToken } = dropboxCredentials();
  if (!appKey || !appSecret || !refreshToken) return null;

  const resp = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey, client_secret: appSecret },
    muteHttpExceptions: true,
  });
  let body;
  try { body = JSON.parse(resp.getContentText()); } catch (err) { return null; }
  if (!body.access_token) return null;
  cache.put('dropbox_access_token', body.access_token, 3300); // 55 min
  return body.access_token;
}

// Dropbox Business accounts on the newer "Team Space" model keep shared
// Team Folders in a namespace separate from the member's own personal one
// — the web UI merges them into one "All files" view, but the API's
// default root only sees the personal namespace, so a plain path like
// "/Summit West Signs Team Folder/..." 404s there even though it's exactly
// what's shown in the browser. Explicitly selecting the account's root
// namespace via this header (cached — it never changes for a given
// account) makes the same paths resolve the way the UI shows them. Fine to
// pass this header even for personal/non-team accounts — Dropbox ignores
// it when the account has no team.
function getDropboxPathRootHeader(accessToken) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dropbox_path_root_header');
  if (cached) return cached === 'none' ? null : cached;

  const resp = UrlFetchApp.fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: 'null',
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) return null;
  let account;
  try { account = JSON.parse(resp.getContentText()); } catch (err) { return null; }
  const namespaceId = account.root_info && account.root_info.root_namespace_id;
  if (!namespaceId) { cache.put('dropbox_path_root_header', 'none', 3300); return null; }

  const header = JSON.stringify({ '.tag': 'root', root: namespaceId });
  cache.put('dropbox_path_root_header', header, 3300); // 55 min, matches the access token's cache lifetime
  return header;
}

function dropboxApiCall(accessToken, endpoint, payload) {
  const pathRoot = getDropboxPathRootHeader(accessToken);
  const headers = { Authorization: 'Bearer ' + accessToken };
  if (pathRoot) headers['Dropbox-API-Path-Root'] = pathRoot;
  const resp = UrlFetchApp.fetch('https://api.dropboxapi.com/2/' + endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers,
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) return null;
  try { return JSON.parse(resp.getContentText()); } catch (err) { return null; }
}

// Runs many independent Dropbox calls concurrently via UrlFetchApp.fetchAll
// instead of one at a time — the bulk refresh (refreshDropboxProofs) is
// dominated by this being the only thing that cuts its wall-clock time,
// since a single job's own 3-call chain (bucket → job folder → Proofs
// folder) is inherently sequential. Chunked well under Apps Script's
// concurrent-URL-Fetch ceiling (undocumented exact number, but batches
// above ~50 have been reported to throw) — a chunk that does throw is
// caught so the rest of the refresh still completes instead of the whole
// thing failing. `calls` is [{endpoint, payload}]; returns parsed bodies in
// the same order, null for any call that errored.
const DROPBOX_BATCH_CHUNK_SIZE = 15;
function dropboxApiCallBatch(accessToken, calls) {
  if (!calls.length) return [];
  const pathRoot = getDropboxPathRootHeader(accessToken);
  const headers = { Authorization: 'Bearer ' + accessToken };
  if (pathRoot) headers['Dropbox-API-Path-Root'] = pathRoot;

  const results = [];
  for (let i = 0; i < calls.length; i += DROPBOX_BATCH_CHUNK_SIZE) {
    const chunk = calls.slice(i, i + DROPBOX_BATCH_CHUNK_SIZE);
    const requests = chunk.map(c => ({
      url: 'https://api.dropboxapi.com/2/' + c.endpoint,
      method: 'post',
      contentType: 'application/json',
      headers,
      payload: JSON.stringify(c.payload || {}),
      muteHttpExceptions: true,
    }));
    let responses;
    try { responses = UrlFetchApp.fetchAll(requests); } catch (err) { chunk.forEach(() => results.push(null)); continue; }
    responses.forEach(resp => {
      const code = resp.getResponseCode();
      if (code < 200 || code >= 300) { results.push(null); return; }
      try { results.push(JSON.parse(resp.getContentText())); } catch (err) { results.push(null); }
    });
  }
  return results;
}

// Picks the newest PDF out of a Proofs folder's file listing. Proof
// filenames follow "..._v{N}.pdf" — the highest N wins; falls back to most
// recently modified when a name doesn't fit that pattern. Shared by the
// single-job path (findLatestProof) and the batched bulk-refresh path
// (findLatestProofsBatch) so the two can't drift apart.
function pickWinnerPdf(pdfs) {
  if (!pdfs.length) return null;
  const versioned = pdfs
    .map(f => ({ file: f, version: (f.name.match(/_v(\d+)\.pdf$/i) || [])[1] }))
    .filter(f => f.version);
  const pool = versioned.length ? versioned : pdfs.map(f => ({ file: f, version: null }));
  pool.sort((a, b) => (a.version && b.version)
    ? (+b.version) - (+a.version)
    : new Date(b.file.server_modified) - new Date(a.file.server_modified));
  const winner = pool[0].file;
  return { id: winner.id, name: winner.name, modified: winner.server_modified };
}

// files/search_v2 scoped to DROPBOX_ORDERS_PATH turned out to return zero
// matches for job folders that plainly exist there (confirmed via the
// Settings debug tool) — Dropbox's search index apparently isn't reliable
// for this path/account, so folder lookup is done by direct traversal
// instead: list the range folders directly under DROPBOX_ORDERS_PATH once
// per refresh (e.g. "_260200 - 260299", every job number 100-wide bucket),
// pick out the pair of numbers in each one's name, and check which
// range(s) bracket the job number. Range-folder naming isn't fully
// consistent (spacing/hyphen conventions vary, and old buckets are
// sometimes duplicated or off by a digit), so this parses whatever two
// 5-6 digit numbers appear in the name rather than assuming an exact
// pattern, and checks every bracketing range if more than one matches.
function listDropboxRangeFolders(accessToken) {
  const folders = [];
  let cursor = null;
  do {
    const resp = cursor
      ? dropboxApiCall(accessToken, 'files/list_folder/continue', { cursor })
      : dropboxApiCall(accessToken, 'files/list_folder', { path: DROPBOX_ORDERS_PATH });
    if (!resp) break;
    resp.entries.forEach(en => {
      if (en['.tag'] !== 'folder') return;
      const nums = en.name.match(/\d{5,6}/g);
      if (!nums || nums.length < 2) return;
      folders.push({ name: en.name, path_lower: en.path_lower, lo: Math.min(+nums[0], +nums[1]), hi: Math.max(+nums[0], +nums[1]) });
    });
    cursor = resp.has_more ? resp.cursor : null;
  } while (cursor);
  return folders;
}

// Finds jobNum's folder among the range folders bracketing it (there can be
// more than one candidate — duplicated/overlapping ranges exist in the
// archive — so every bracketing range is checked until one actually
// contains the job's subfolder).
function findJobFolder(accessToken, jobNum, rangeFolders) {
  const n = +jobNum;
  const candidates = rangeFolders.filter(r => n >= r.lo && n <= r.hi);
  for (let i = 0; i < candidates.length; i++) {
    const listing = dropboxApiCall(accessToken, 'files/list_folder', { path: candidates[i].path_lower });
    if (!listing || !listing.entries) continue;
    const match = listing.entries.find(en => en['.tag'] === 'folder' && new RegExp('^' + jobNum + '[_ ]').test(en.name));
    if (match) return match;
  }
  return null;
}

// Finds the newest PDF in jobNum's Proofs subfolder. Proof filenames follow
// "..._v{N}.pdf" — the highest N wins; falls back to most recently modified
// when a name doesn't fit that pattern.
function findLatestProof(accessToken, jobNum, rangeFolders) {
  const folderMatch = findJobFolder(accessToken, jobNum, rangeFolders);
  if (!folderMatch) return null;

  const listing = dropboxApiCall(accessToken, 'files/list_folder', { path: folderMatch.path_lower });
  if (!listing || !listing.entries) return null;
  const proofsFolder = listing.entries.find(en => en['.tag'] === 'folder' && en.name.toLowerCase() === 'proofs');
  if (!proofsFolder) return null;

  const proofsListing = dropboxApiCall(accessToken, 'files/list_folder', { path: proofsFolder.path_lower });
  if (!proofsListing || !proofsListing.entries) return null;
  const pdfs = proofsListing.entries.filter(en => en['.tag'] === 'file' && /\.pdf$/i.test(en.name));
  return pickWinnerPdf(pdfs);
}

// Bulk equivalent of findLatestProof for many jobs at once — instead of
// each job running its own sequential 3-call chain, this runs the whole
// job list in three concurrent waves (bucket folders → job folders →
// Proofs folders), deduping repeated folder paths so jobs sharing a bucket
// only fetch it once. Returns { [jobNum]: proof-or-null }.
function findLatestProofsBatch(accessToken, jobNums, rangeFolders) {
  const result = {};

  // Wave 1: list every distinct range-bucket folder that brackets any of
  // these jobs (jobs sharing a bucket, e.g. two jobs both in
  // "_260200 - 260299", reuse the same listing instead of each re-fetching it).
  const candidatesByJobNum = {};
  const bucketPaths = new Set();
  jobNums.forEach(jobNum => {
    const n = +jobNum;
    const candidates = rangeFolders.filter(r => n >= r.lo && n <= r.hi);
    candidatesByJobNum[jobNum] = candidates;
    candidates.forEach(c => bucketPaths.add(c.path_lower));
  });
  const bucketPathList = Array.from(bucketPaths);
  const bucketListings = dropboxApiCallBatch(accessToken, bucketPathList.map(path => ({ endpoint: 'files/list_folder', payload: { path } })));
  const entriesByBucketPath = {};
  bucketPathList.forEach((path, i) => { entriesByBucketPath[path] = (bucketListings[i] && bucketListings[i].entries) || []; });

  // Wave 2: find each job's own folder inside its bracketing bucket(s)
  // (already fetched above, no extra calls), then batch-list every
  // distinct job folder found.
  const jobFolderByJobNum = {};
  const jobFolderPaths = new Set();
  jobNums.forEach(jobNum => {
    const candidates = candidatesByJobNum[jobNum];
    for (let i = 0; i < candidates.length; i++) {
      const entries = entriesByBucketPath[candidates[i].path_lower];
      const match = entries.find(en => en['.tag'] === 'folder' && new RegExp('^' + jobNum + '[_ ]').test(en.name));
      if (match) { jobFolderByJobNum[jobNum] = match; jobFolderPaths.add(match.path_lower); break; }
    }
  });
  const jobFolderPathList = Array.from(jobFolderPaths);
  const jobFolderListings = dropboxApiCallBatch(accessToken, jobFolderPathList.map(path => ({ endpoint: 'files/list_folder', payload: { path } })));
  const entriesByJobFolderPath = {};
  jobFolderPathList.forEach((path, i) => { entriesByJobFolderPath[path] = (jobFolderListings[i] && jobFolderListings[i].entries) || []; });

  // Wave 3: find each job's Proofs subfolder, then batch-list every
  // distinct one found.
  const proofsFolderByJobNum = {};
  const proofsFolderPaths = new Set();
  jobNums.forEach(jobNum => {
    const jobFolder = jobFolderByJobNum[jobNum];
    if (!jobFolder) return;
    const entries = entriesByJobFolderPath[jobFolder.path_lower];
    const proofsFolder = entries.find(en => en['.tag'] === 'folder' && en.name.toLowerCase() === 'proofs');
    if (proofsFolder) { proofsFolderByJobNum[jobNum] = proofsFolder; proofsFolderPaths.add(proofsFolder.path_lower); }
  });
  const proofsFolderPathList = Array.from(proofsFolderPaths);
  const proofsListings = dropboxApiCallBatch(accessToken, proofsFolderPathList.map(path => ({ endpoint: 'files/list_folder', payload: { path } })));
  const entriesByProofsPath = {};
  proofsFolderPathList.forEach((path, i) => { entriesByProofsPath[path] = (proofsListings[i] && proofsListings[i].entries) || []; });

  jobNums.forEach(jobNum => {
    const proofsFolder = proofsFolderByJobNum[jobNum];
    if (!proofsFolder) { result[jobNum] = null; return; }
    const entries = entriesByProofsPath[proofsFolder.path_lower];
    const pdfs = entries.filter(en => en['.tag'] === 'file' && /\.pdf$/i.test(en.name));
    result[jobNum] = pickWinnerPdf(pdfs);
  });

  return result;
}

// Admin-only diagnostic for Settings — retraces findLatestProof's steps one
// at a time and reports what happened at each, so a mismatch (wrong range
// bucket, no Proofs subfolder, no PDFs) can be pinpointed instead of
// guessed at.
function debugFindLatestProof(jobNum) {
  if (!jobNum) return { error: 'jobNum required' };
  const accessToken = getDropboxAccessToken();
  if (!accessToken) return { error: 'Could not get a Dropbox access token — check connection in Settings' };

  const acctResp = UrlFetchApp.fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: 'null',
    muteHttpExceptions: true,
  });
  const accountDebug = { code: acctResp.getResponseCode(), body: acctResp.getContentText() };

  const pathRoot = getDropboxPathRootHeader(accessToken);
  const rootHeaders = { Authorization: 'Bearer ' + accessToken };
  if (pathRoot) rootHeaders['Dropbox-API-Path-Root'] = pathRoot;
  const rootResp = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'post',
    contentType: 'application/json',
    headers: rootHeaders,
    payload: JSON.stringify({ path: DROPBOX_ORDERS_PATH }),
    muteHttpExceptions: true,
  });
  if (rootResp.getResponseCode() !== 200) {
    return { step: 'list_folder (01 Orders root)', usedPathRootHeader: !!pathRoot, accountDebug, code: rootResp.getResponseCode(), body: rootResp.getContentText() };
  }

  const rangeFolders = listDropboxRangeFolders(accessToken);
  const n = +jobNum;
  const candidates = rangeFolders.filter(r => n >= r.lo && n <= r.hi);
  if (!candidates.length) {
    return { step: 'range folders', usedPathRootHeader: !!pathRoot, totalRangeFolders: rangeFolders.length, error: 'No range folder under "01 Orders" brackets job number ' + jobNum };
  }

  for (let i = 0; i < candidates.length; i++) {
    const range = candidates[i];
    const listing = dropboxApiCall(accessToken, 'files/list_folder', { path: range.path_lower });
    if (!listing || !listing.entries) {
      return { step: 'list_folder (range folder)', rangeFolder: range.name, error: 'list_folder failed for ' + range.path_lower };
    }
    const folderMatch = listing.entries.find(en => en['.tag'] === 'folder' && new RegExp('^' + jobNum + '[_ ]').test(en.name));
    if (!folderMatch) continue;

    const jobListing = dropboxApiCall(accessToken, 'files/list_folder', { path: folderMatch.path_lower });
    if (!jobListing || !jobListing.entries) {
      return { step: 'list_folder (job folder)', rangeFolder: range.name, folderMatch: folderMatch.name, error: 'list_folder failed for job folder' };
    }
    const proofsFolder = jobListing.entries.find(en => en['.tag'] === 'folder' && en.name.toLowerCase() === 'proofs');
    if (!proofsFolder) {
      return { step: 'list_folder (job folder)', rangeFolder: range.name, folderMatch: folderMatch.name, entries: jobListing.entries.map(en => en.name), error: 'No "Proofs" subfolder found' };
    }

    const proofsListing = dropboxApiCall(accessToken, 'files/list_folder', { path: proofsFolder.path_lower });
    if (!proofsListing || !proofsListing.entries) {
      return { step: 'list_folder (Proofs)', rangeFolder: range.name, folderMatch: folderMatch.name, error: 'list_folder failed for Proofs subfolder' };
    }
    const pdfs = proofsListing.entries.filter(en => en['.tag'] === 'file' && /\.pdf$/i.test(en.name));
    if (!pdfs.length) {
      return { step: 'list_folder (Proofs)', rangeFolder: range.name, folderMatch: folderMatch.name, entries: proofsListing.entries.map(en => en.name), error: 'No PDFs in Proofs folder' };
    }

    const proof = findLatestProof(accessToken, jobNum, rangeFolders);
    return { step: 'done', rangeFolder: range.name, folderMatch: folderMatch.name, pdfsFound: pdfs.map(f => f.name), winner: proof };
  }

  return { step: 'list_folder (range folder)', candidateRangeFolders: candidates.map(r => r.name), error: 'Job folder not found in any bracketing range folder' };
}

function getDropboxProofsSheet() {
  const ss = getTrackingSpreadsheet();
  let sheet = ss.getSheetByName('DropboxProofs');
  if (!sheet) {
    sheet = ss.insertSheet('DropboxProofs');
    sheet.appendRow(['job_num', 'file_id', 'file_name', 'modified', 'checked_at', 'drive_file_id']);
  }
  return sheet;
}

// Drive folder holding pre-fetched PDF bytes for active jobs' proofs, so
// opening a job is instant for everyone — not just whoever happens to view
// it first — since up to a dozen people can be working the same job at
// once. Populated during refreshDropboxProofs, evicted the moment a job is
// marked complete (see the toggleComplete handler above). Needs the full
// `drive` scope, not the narrower drive.file — Apps Script's DriveApp
// service requires it for creating files/folders from scratch (drive.file
// only covers files opened via a picker), even though this script only
// ever touches this one folder in practice.
function getProofCacheFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('PROOF_CACHE_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder('SWS Prod Calendar - Cached Proofs');
  props.setProperty('PROOF_CACHE_FOLDER_ID', folder.getId());
  return folder;
}

// Downloads a file's raw bytes from Dropbox by id. Shared by the
// cache-warming path (refreshDropboxProofs) and the live-fallback path
// (getDropboxProofFile) so they can't drift apart.
function downloadDropboxFileBytes(accessToken, fileId) {
  const pathRoot = getDropboxPathRootHeader(accessToken);
  const headers = {
    Authorization: 'Bearer ' + accessToken,
    'Dropbox-API-Arg': JSON.stringify({ path: fileId }),
  };
  if (pathRoot) headers['Dropbox-API-Path-Root'] = pathRoot;
  const resp = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'post',
    headers,
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) return null;
  return resp.getBlob();
}

// Re-searches Dropbox for every job currently in the app's default calendar
// window and refreshes its cached proof pointer — and, unless the winning
// file is unchanged since last time, pre-downloads it into Drive so the
// next person to open that job gets it instantly instead of waiting on a
// live Dropbox round-trip. Runs on an hourly trigger (see
// ensureDropboxRefreshTrigger) plus once right after connecting, and can be
// kicked manually from Settings.
function refreshDropboxProofs() {
  const accessToken = getDropboxAccessToken();
  if (!accessToken) return;

  const { start, end } = defaultCalendarWindow();
  const tracking = getAllTracking();
  // Completed jobs don't need their proof re-checked every refresh — this
  // is the main lever on runtime, since each remaining job costs a few
  // serial Dropbox API calls (range folder lookup, job folder, Proofs
  // folder) with no concurrency available in Apps Script.
  const jobNums = getCalendarJobs(start, end)
    .filter(j => !(tracking[j.jobNum] && tracking[j.jobNum].completed))
    .map(j => j.jobNum);
  const rangeFolders = listDropboxRangeFolders(accessToken);
  let proofByJobNum = {};
  try { proofByJobNum = findLatestProofsBatch(accessToken, jobNums, rangeFolders); } catch (err) { proofByJobNum = {}; }

  const sheet = getDropboxProofsSheet();
  const data = sheet.getDataRange().getValues();
  const rowByJobNum = {};
  for (let i = 1; i < data.length; i++) rowByJobNum[String(data[i][0])] = i + 1;

  let folder = null;
  const checkedAt = new Date().toISOString();
  jobNums.forEach(jobNum => {
    const proof = proofByJobNum[jobNum] || null;
    const rowIndex = rowByJobNum[jobNum];
    const prevRow = rowIndex ? data[rowIndex - 1] : null;
    const prevFileId = prevRow ? prevRow[1] : '';
    const prevDriveFileId = prevRow ? prevRow[5] : '';

    let driveFileId = '';
    if (proof && proof.id === prevFileId && prevDriveFileId) {
      // Unchanged since last refresh — no need to re-download/re-upload
      // the same bytes.
      driveFileId = prevDriveFileId;
    } else if (proof) {
      try {
        if (!folder) folder = getProofCacheFolder();
        const blob = downloadDropboxFileBytes(accessToken, proof.id);
        if (blob) {
          if (prevDriveFileId) { try { DriveApp.getFileById(prevDriveFileId).setTrashed(true); } catch (err) { /* already gone */ } }
          driveFileId = folder.createFile(blob.setName(jobNum + '.pdf')).getId();
        }
      } catch (err) {
        // Pre-caching is best-effort — getDropboxProofFile falls back to a
        // live Dropbox fetch when there's no cached copy, so a failure
        // here (e.g. the Drive scope hasn't been authorized yet) just
        // means that job's proof loads a bit slower on first view instead
        // of instantly, not a broken feature.
        driveFileId = '';
      }
    } else if (prevDriveFileId) {
      // No longer has a matching proof — drop the stale cached copy.
      try { DriveApp.getFileById(prevDriveFileId).setTrashed(true); } catch (err) { /* already gone */ }
    }

    const row = [jobNum, proof ? proof.id : '', proof ? proof.name : '', proof ? proof.modified : '', checkedAt, driveFileId];
    if (rowIndex) {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

// Drops a job's pre-fetched proof cache — called the moment it's marked
// complete (see the toggleComplete handler above), since a completed job no
// longer needs to be instantly available for a dozen people at once.
function evictProofCache(jobNum) {
  const sheet = getDropboxProofsSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jobNum)) {
      const driveFileId = data[i][5];
      if (driveFileId) {
        try { DriveApp.getFileById(driveFileId).setTrashed(true); } catch (err) { /* already gone */ }
        sheet.getRange(i + 1, 6).setValue('');
      }
      return;
    }
  }
}

function getCachedProof(jobNum) {
  const sheet = getDropboxProofsSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jobNum) && data[i][1]) {
      return { id: data[i][1], name: data[i][2], driveFileId: data[i][5] || '' };
    }
  }
  return null;
}

// Fetches the actual PDF bytes — only called when someone opens a job's
// Proof section, never as part of the main job list (that's the one call in
// this feature too slow to run for every job on every load). Serves from
// the pre-fetched Drive copy when there is one (instant, no Dropbox
// round-trip — the common case for an active job someone else already
// opened first); falls back to a live Dropbox download otherwise (a brand
// new job that hasn't had its first refresh yet, or a completed job whose
// cache was evicted).
function getDropboxProofFile(jobNum) {
  if (!jobNum || !isDropboxConnected()) return { available: false };
  const proof = getCachedProof(jobNum);
  if (!proof) return { available: false };

  if (proof.driveFileId) {
    try {
      const blob = DriveApp.getFileById(proof.driveFileId).getBlob();
      return { available: true, name: proof.name, base64: Utilities.base64Encode(blob.getBytes()) };
    } catch (err) {
      // Cached copy missing/inaccessible — fall through to a live fetch.
    }
  }

  const accessToken = getDropboxAccessToken();
  if (!accessToken) return { available: false };
  const blob = downloadDropboxFileBytes(accessToken, proof.id);
  if (!blob) return { available: false };
  return { available: true, name: proof.name, base64: Utilities.base64Encode(blob.getBytes()) };
}

function ensureDropboxRefreshTrigger() {
  const already = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshDropboxProofs');
  if (already) return;
  ScriptApp.newTrigger('refreshDropboxProofs').timeBased().everyHours(DROPBOX_PROOFS_REFRESH_HOURS).create();
}

// ── Dropbox OAuth connect (Settings → Admin only) ───────────────────────────
function dropboxAuthUrl(scriptUrl) {
  const { appKey } = dropboxCredentials();
  if (!appKey) return null;
  const state = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('DROPBOX_OAUTH_STATE', state);
  const params = {
    client_id: appKey,
    response_type: 'code',
    token_access_type: 'offline',
    redirect_uri: scriptUrl,
    state,
  };
  const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  return 'https://www.dropbox.com/oauth2/authorize?' + qs;
}

// Dropbox's redirect back to our /exec URL lands here with no token of ours
// — `state` is our only CSRF defense, so it must match what dropboxAuthUrl
// just stored before the code is trusted.
function handleDropboxOAuthCallback(e, scriptUrl) {
  const expectedState = PropertiesService.getScriptProperties().getProperty('DROPBOX_OAUTH_STATE');
  if (!e.parameter.code || !expectedState || e.parameter.state !== expectedState) {
    return HtmlService.createHtmlOutput('<p>Dropbox connection failed (invalid or expired request). Close this tab and try again from Settings.</p>');
  }
  const { appKey, appSecret } = dropboxCredentials();
  const resp = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: { code: e.parameter.code, grant_type: 'authorization_code', client_id: appKey, client_secret: appSecret, redirect_uri: scriptUrl },
    muteHttpExceptions: true,
  });
  let body;
  try { body = JSON.parse(resp.getContentText()); } catch (err) { body = {}; }
  if (!body.refresh_token) {
    return HtmlService.createHtmlOutput('<p>Dropbox connection failed: ' + (body.error_description || body.error || 'unknown error') + '. Close this tab and try again from Settings.</p>');
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DROPBOX_REFRESH_TOKEN', body.refresh_token);
  props.deleteProperty('DROPBOX_OAUTH_STATE');
  CacheService.getScriptCache().remove('dropbox_access_token');
  ensureDropboxRefreshTrigger();
  try { refreshDropboxProofs(); } catch (err) { /* best-effort; the hourly trigger will catch up */ }
  return HtmlService.createHtmlOutput('<p>Dropbox connected. You can close this tab and go back to the app.</p>');
}

