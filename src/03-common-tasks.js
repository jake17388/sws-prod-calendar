// ── Common task phrases ─────────────────────────────────────────────────────
// Manager/Admin-created shortcuts shown inside a selected department's task
// editor. Stored in Script Properties because they are app configuration, not
// per-job tracking data. Each record is
// { id, text, allDepartments, departments }.
function getCommonTasks() {
  const raw = PropertiesService.getScriptProperties().getProperty('COMMON_TASKS');
  if (!raw) return [];
  try {
    const tasks = JSON.parse(raw);
    return Array.isArray(tasks) ? tasks : [];
  } catch (err) {
    return [];
  }
}

function saveCommonTasks(actor, data) {
  if (!canAssignDepartments(actor.department)) return { success: false, error: 'forbidden' };
  if (!Array.isArray(data.tasks)) return { success: false, error: 'Tasks are required' };
  if (data.tasks.length > 50) return { success: false, error: 'Up to 50 common tasks are allowed' };

  const tasks = [];
  for (let i = 0; i < data.tasks.length; i++) {
    const raw = data.tasks[i] || {};
    const text = String(raw.text || '').trim();
    if (!text) return { success: false, error: 'Every common task needs text' };
    if (text.length > 160) return { success: false, error: 'Common task text must be 160 characters or less' };

    const allDepartments = raw.allDepartments === true;
    const departments = allDepartments ? [] : [...new Set(
      (Array.isArray(raw.departments) ? raw.departments : [])
        .map(String)
        .filter(dept => JOB_TAGS.indexOf(dept) !== -1),
    )];
    if (!allDepartments && !departments.length) {
      return { success: false, error: 'Choose at least one department or All Departments' };
    }
    // Reject rather than silently dropping an unknown department so a stale
    // or tampered client never makes a phrase appear more narrowly scoped than
    // the manager intended.
    const suppliedDepartments = Array.isArray(raw.departments) ? raw.departments.map(String) : [];
    if (!allDepartments && suppliedDepartments.some(dept => JOB_TAGS.indexOf(dept) === -1)) {
      return { success: false, error: 'Invalid department' };
    }
    const id = String(raw.id || Utilities.getUuid());
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return { success: false, error: 'Invalid common task id' };
    tasks.push({
      id,
      text,
      allDepartments,
      departments,
    });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    PropertiesService.getScriptProperties().setProperty('COMMON_TASKS', JSON.stringify(tasks));
    return { success: true, tasks };
  } finally {
    lock.releaseLock();
  }
}

// Global non-job activities available to every production department in the
// Job Selector. A missing property means a new installation and receives the
// defaults; an explicitly saved [] remains empty.
const DEFAULT_COSTING_BUTTONS = [
  { id: 'loading-unloading', text: 'Loading/Unloading' },
  { id: 'team-support', text: 'Team Support' },
  { id: 'pm-sales', text: 'PM/Sales' },
];

function getCostingButtons() {
  const raw = PropertiesService.getScriptProperties().getProperty('COSTING_BUTTONS');
  if (raw == null) return DEFAULT_COSTING_BUTTONS.map(button => ({ ...button }));
  try {
    const buttons = JSON.parse(raw);
    return Array.isArray(buttons) ? buttons : DEFAULT_COSTING_BUTTONS.map(button => ({ ...button }));
  } catch (err) {
    return DEFAULT_COSTING_BUTTONS.map(button => ({ ...button }));
  }
}

function saveCostingButtons(actor, data) {
  if (!actor || !canManageCostingButtons(actor.department)) return { success: false, error: 'forbidden' };
  if (!Array.isArray(data.buttons)) return { success: false, error: 'Buttons are required' };
  if (data.buttons.length > 25) return { success: false, error: 'Up to 25 costing buttons are allowed' };

  const buttons = [];
  const labels = new Set();
  const ids = new Set();
  for (let i = 0; i < data.buttons.length; i++) {
    const raw = data.buttons[i] || {};
    const text = String(raw.text || '').trim();
    if (!text) return { success: false, error: 'Every costing button needs text' };
    if (text.length > 80 || /[\u0000-\u001f\u007f]/.test(text)) {
      return { success: false, error: 'Costing button text must be 80 characters or less' };
    }
    const normalized = text.toLocaleLowerCase();
    if (labels.has(normalized)) return { success: false, error: 'Costing button names must be unique' };
    labels.add(normalized);
    const id = String(raw.id || Utilities.getUuid());
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return { success: false, error: 'Invalid costing button id' };
    if (ids.has(id)) return { success: false, error: 'Costing button ids must be unique' };
    ids.add(id);
    buttons.push({ id, text });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    PropertiesService.getScriptProperties().setProperty('COSTING_BUTTONS', JSON.stringify(buttons));
    return { success: true, buttons };
  } finally {
    lock.releaseLock();
  }
}

function validPin(pin) {
  return /^\d{6}$/.test(String(pin || ''));
}

function validName(name) {
  return !!name && name.length <= 80 && !/^[=+\-@]/.test(name) && !/[\u0000-\u001f\u007f]/.test(name);
}

function addUser(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  const name = String(data.name || '').trim();
  const department = String(data.department || '');
  const pin = String(data.pin || '');
  if (!validName(name)) return { success: false, error: 'Name must be 1–80 characters' };
  if (DEPARTMENTS.indexOf(department) === -1) return { success: false, error: 'Invalid department' };
  if (!canManageDepartment(actor.department, department)) return { success: false, error: 'forbidden' };
  if (!validPin(pin)) return { success: false, error: 'PIN must be 6 digits' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    if (pinAlreadyUsed(users, pin)) return { success: false, error: 'That PIN is already in use' };
    const newUser = withNewPin({ id: Utilities.getUuid(), name, department, authVersion: 1, mustChangePin: true }, pin);
    users.push(newUser);
    saveUsers(users);
    return { success: true, user: userFor(actor, newUser) };
  } finally {
    lock.releaseLock();
  }
}

function updateUser(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(data.id || ''))) return { success: false, error: 'Invalid user id' };
  if (data.temporaryPin !== undefined && actor.department !== 'Admin') return { success: false, error: 'forbidden' };
  if (data.temporaryPin !== undefined && typeof data.temporaryPin !== 'boolean') {
    return { success: false, error: 'Invalid PIN type' };
  }
  if (data.temporaryPin !== undefined && data.pin === undefined) {
    return { success: false, error: 'PIN is required when choosing PIN type' };
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    const idx = users.findIndex(u => u.id === data.id);
    if (idx === -1) return { success: false, error: 'User not found' };
    const target = users[idx];
    if (!canManageDepartment(actor.department, target.department)) return { success: false, error: 'forbidden' };

    const next = { ...target };
    let pinChanged = false;
    if (data.name !== undefined) {
      if (actor.department !== 'Admin') return { success: false, error: 'forbidden' };
      const name = String(data.name).trim();
      if (!validName(name)) return { success: false, error: 'Name must be 1–80 characters' };
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
      if (!validPin(pin)) return { success: false, error: 'PIN must be 6 digits' };
      if (pinAlreadyUsed(users, pin, target.id)) return { success: false, error: 'That PIN is already in use' };
      Object.assign(next, withNewPin(next, pin));
      next.authVersion = (+next.authVersion || 1) + 1;
      // Resets remain temporary by default for compatibility and safety.
      // Only an Admin may explicitly issue a regular PIN.
      next.mustChangePin = actor.department === 'Admin' ? data.temporaryPin !== false : true;
      delete next.previousAuthVersion;
      delete next.previousAuthExpiresAt;
      pinChanged = true;
    }
    users[idx] = next;
    saveUsers(users);
    return { success: true, user: userFor(actor, next), token: pinChanged && target.id === actor.id ? makeToken(next) : undefined };
  } finally {
    lock.releaseLock();
  }
}

function deleteUser(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(data.id || ''))) return { success: false, error: 'Invalid user id' };
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

// Lets every signed-in user change their own PIN, independent of
// canAccessUserManagement. Admins may also change their own name; everyone
// else needs an Admin to rename the account. Deliberately ignores any
// `department` field so nobody can promote themselves.
function updateSelf(actor, data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    const idx = users.findIndex(u => u.id === actor.id);
    if (idx === -1) return { success: false, error: 'User not found' };
    const next = { ...users[idx] };
    let pinChanged = false;
    if (data.name !== undefined) {
      if (actor.department !== 'Admin') return { success: false, error: 'forbidden' };
      const name = String(data.name).trim();
      if (!validName(name)) return { success: false, error: 'Name must be 1–80 characters' };
      next.name = name;
    }
    if (data.pin !== undefined) {
      const pin = String(data.pin);
      if (!validPin(pin)) return { success: false, error: 'PIN must be 6 digits' };
      if (next.mustChangePin && pinMatches(next, pin)) return { success: false, error: 'Choose a different PIN' };
      if (pinAlreadyUsed(users, pin, next.id)) return { success: false, error: 'That PIN is already in use' };
      Object.assign(next, withNewPin(next, pin));
      const currentAuthVersion = +next.authVersion || 1;
      next.previousAuthVersion = currentAuthVersion;
      next.previousAuthExpiresAt = Date.now() + TOKEN_HANDOFF_GRACE_MS;
      next.authVersion = currentAuthVersion + 1;
      next.mustChangePin = false;
      pinChanged = true;
    }
    users[idx] = next;
    saveUsers(users);
    return { success: true, user: publicUser(next), token: pinChanged ? makeToken(next) : undefined };
  } finally {
    lock.releaseLock();
  }
}

function revokeUserSessions(actor, data) {
  if (!canAccessUserManagement(actor.department)) return { success: false, error: 'forbidden' };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(data.id || ''))) return { success: false, error: 'Invalid user id' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const users = getUsers();
    const idx = users.findIndex(user => user.id === String(data.id || ''));
    if (idx === -1) return { success: false, error: 'User not found' };
    if (!canManageDepartment(actor.department, users[idx].department)) return { success: false, error: 'forbidden' };
    users[idx].authVersion = (+users[idx].authVersion || 1) + 1;
    delete users[idx].previousAuthVersion;
    delete users[idx].previousAuthExpiresAt;
    saveUsers(users);
    return { success: true };
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

function makeToken(user) {
  const ttl = user.department === 'TV' ? TV_TOKEN_TTL_MS : TOKEN_TTL_MS;
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ uid: user.id, v: +user.authVersion || 1, e: Date.now() + ttl }));
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
  return data;
}

// Resolves a token to the current { id, name, department, pin } record, or
// null if the token is invalid/expired/unsigned or the account behind it has
// since been deleted.
function resolveActor(token) {
  const session = verifyToken(token);
  if (!session) return null;
  const user = getUsers().find(u => u.id === session.uid) || null;
  if (!user) return null;
  const sessionVersion = +session.v || 1;
  const currentVersionMatches = (+user.authVersion || 1) === sessionVersion;
  const handoffVersionMatches = (+user.previousAuthVersion || 0) === sessionVersion
    && (+user.previousAuthExpiresAt || 0) >= Date.now();
  if (!currentVersionMatches && !handoffVersionMatches) return null;
  return user;
}
