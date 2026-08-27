import { AUTH_KEY } from './config.js';
import { scriptPost } from './api.js';
import { clearCachedJobs } from './jobsCache.js';
import { getDeviceId } from './deviceId.js';

const INACTIVITY_TTL_MS = 2 * 60 * 60 * 1000;
let auth = readAuth(); // { token, user } — validated server-side on every call
let pinEntry = '';
let pinBusy = false;
let lastActivityWrite = 0;

function readAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    let stored = JSON.parse(raw);
    if (stored && stored.department !== 'TV' && stored.lastActiveAt && Date.now() - stored.lastActiveAt > INACTIVITY_TTL_MS) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    // Sessions written before PINs were removed from the session object still
    // have one sitting in localStorage. Strip it on first read and rewrite, so
    // existing installs stop carrying a live credential without needing anyone
    // to sign out and back in.
    if (stored && stored.pin !== undefined) {
      const { pin, isDueDateEditor, ...rest } = stored;
      stored = rest;
    }
    if (stored && !stored.userId) stored.userId = userIdFromToken(stored.token);
    if (stored && !stored.lastActiveAt) stored.lastActiveAt = Date.now();
    if (stored) localStorage.setItem(AUTH_KEY, JSON.stringify(stored));
    return stored;
  } catch (err) {
    return null;
  }
}

function userIdFromToken(token) {
  try {
    let encoded = String(token || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    encoded += '='.repeat((4 - encoded.length % 4) % 4);
    return JSON.parse(atob(encoded)).uid || null;
  } catch (err) {
    return null;
  }
}

export const getAuth = () => auth;
export const currentUser = () => auth ? auth.user : null;
export const currentUserId = () => auth ? auth.userId : null;
export const currentDepartment = () => auth ? auth.department : null;
export const isTvDisplay = () => !!auth && auth.department === 'TV';
// Derived from department, matching canEditDueDates() in Code.js. This used to
// read a name-based `isDueDateEditor` flag baked into the session at login —
// see the Code.js comment for why keying a permission off an editable name was
// a privilege escalation. Deriving it here also means sessions cached in
// localStorage before this change self-correct instead of keeping a stale flag.
export const canEditDueDates = () => !!auth && auth.department === 'Admin';
export const canManageUsers = () => !!(auth && auth.canManageUsers);
// Only Admin/Manager can mark an entire job complete or assign departments.
export const canMarkJobComplete = () => !!auth && (auth.department === 'Admin' || auth.department === 'Manager');
export const canAssignDepartments = () => !!auth && (auth.department === 'Admin' || auth.department === 'Manager');
export const canUseJobSelector = () => !!auth && ['Manufacturing', 'Graphics', 'Routing', 'Paint', 'Letters', 'Assembly'].includes(auth.department);
export const canViewHoursLog = () => !!auth && (auth.department === 'Admin' || auth.canViewHoursLog === true);
export const canUploadAdditionalFiles = () => !!auth && ['Admin', 'Manager', 'Viewer'].includes(auth.department);
export const isAdmin = () => !!auth && auth.department === 'Admin';
export const mustChangePin = () => !!auth && !!auth.mustChangePin;
// Now shown to everyone with a session, including production-department
// accounts — a job can show departments other than their own (they see
// every job their department is ever assigned, not just current ones), and
// the per-department progress bar next to each badge is useful to them too.
export const canSeeDepartmentBadges = () => !!auth;

/** Merges a patch (e.g. after a "My Account" save) into the cached session and persists it. */
export function updateAuthProfile(patch) {
  if (!auth) return;
  auth = { ...auth, ...patch };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function touchSession() {
  if (!auth || Date.now() - lastActivityWrite < 60000) return;
  lastActivityWrite = Date.now();
  auth = { ...auth, lastActiveAt: lastActivityWrite };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function signOut() {
  localStorage.removeItem(AUTH_KEY);
  clearCachedJobs(); // shared devices shouldn't flash a previous account's data on the next login
  auth = null;
  pinEntry = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('pin-screen').style.display = 'flex';
  setPinMessage('');
  setPinBusy(false);
  renderDots();
}

// Touch browsers can delay or coalesce click events when someone taps the
// keypad quickly. Handle touch/pen on pointerdown instead, then suppress only
// that pointer's compatibility click. Mouse, keyboard, and assistive-tech
// clicks continue through the normal click handler.
function bindPinButton(button, onActivate) {
  let directPointerAt = -Infinity;
  button.addEventListener('pointerdown', event => {
    const isDirectTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (!isDirectTouch) return;
    event.preventDefault();
    directPointerAt = event.timeStamp;
    button.classList.add('pin-key-pressed');
    setTimeout(() => button.classList.remove('pin-key-pressed'), 120);
    onActivate();
  });
  button.addEventListener('click', event => {
    const followsDirectPointer = event.detail > 0 && event.timeStamp - directPointerAt < 1000;
    if (followsDirectPointer) {
      event.preventDefault();
      return;
    }
    onActivate();
  });
}

/**
 * Wires up the PIN pad and shows either the PIN screen or the app shell
 * depending on whether a valid session is already cached.
 * @param {() => void} onLogin called once a session is established
 */
export function initAuth(onLogin) {
  document.querySelectorAll('.pin-pad button[data-digit]').forEach(btn => {
    bindPinButton(btn, () => pinKey(btn.dataset.digit, onLogin));
  });
  bindPinButton(document.getElementById('pin-del'), pinDel);
  document.addEventListener('keydown', e => {
    if (auth) return;
    if (e.key >= '0' && e.key <= '9') pinKey(e.key, onLogin);
    if (e.key === 'Backspace') pinDel();
  });
  ['pointerdown', 'keydown'].forEach(eventName => document.addEventListener(eventName, touchSession, { passive: true }));
  setInterval(() => {
    if (auth && auth.department !== 'TV' && auth.lastActiveAt && Date.now() - auth.lastActiveAt > INACTIVITY_TTL_MS) signOut();
  }, 60000);

  if (auth) {
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    onLogin();
  } else {
    document.getElementById('pin-screen').style.display = 'flex';
  }
}

function renderDots() {
  const dots = document.querySelectorAll('.pin-dots span');
  dots.forEach((dot, i) => dot.classList.toggle('filled', i < pinEntry.length));
}

function pinKey(digit, onLogin) {
  if (pinBusy || pinEntry.length >= 6) return;
  if (!pinEntry) setPinMessage('');
  pinEntry += digit;
  renderDots();
  if (pinEntry.length === 6) submitPin(onLogin);
}

function pinDel() {
  if (pinBusy) return;
  pinEntry = pinEntry.slice(0, -1);
  renderDots();
}

function setPinBusy(busy) {
  pinBusy = busy;
  const screen = document.getElementById('pin-screen');
  screen.classList.toggle('is-verifying', busy);
  screen.setAttribute('aria-busy', String(busy));
}

function setPinMessage(message, state = '') {
  const errorEl = document.getElementById('pin-error');
  errorEl.textContent = message;
  errorEl.dataset.state = state;
  const card = document.querySelector('.pin-card');
  card.classList.toggle('has-error', state === 'error');
  if (state === 'error') {
    card.classList.remove('pin-shake');
    requestAnimationFrame(() => card.classList.add('pin-shake'));
  }
}

// The server returns how long the lockout has left, so this reports the real
// remaining time instead of the flat "10 minutes" it used to claim — which was
// wrong whenever the lockout was partly elapsed, and wrong again whenever the
// old global counter silently pushed the unlock time back.
function lockoutMessage(retryInSeconds) {
  if (!retryInSeconds || retryInSeconds < 0) return 'Too many attempts — try again shortly.';
  const minutes = Math.ceil(retryInSeconds / 60);
  return `Too many attempts — try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

function submitPin(onLogin) {
  const submittedPin = pinEntry;
  setPinBusy(true);
  setPinMessage('Verifying…', 'busy');
  scriptPost({ action: 'login', pin: submittedPin, deviceId: getDeviceId() })
    .then(res => {
      setPinBusy(false);
      if (!res.ok) {
        setPinMessage(res.locked ? lockoutMessage(res.retryInSeconds) : 'Incorrect PIN', 'error');
        pinEntry = '';
        renderDots();
        return;
      }
      // The PIN is deliberately NOT stored. It used to be kept here purely so
      // the Settings panel could prefill the field, which left a working
      // credential sitting in localStorage for any XSS — or anyone holding the
      // device — to read. Settings now asks for a new PIN instead of showing
      // the current one.
      auth = { token: res.token, userId: res.userId, user: res.user, department: res.department, canManageUsers: !!res.canManageUsers, mustChangePin: !!res.mustChangePin, lastActiveAt: Date.now() };
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      pinEntry = '';
      renderDots();
      setPinMessage('');
      document.getElementById('pin-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      onLogin();
    })
    .catch(() => {
      setPinBusy(false);
      setPinMessage('Network error — try again.', 'error');
      pinEntry = '';
      renderDots();
    });
}
