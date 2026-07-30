import { AUTH_KEY } from './config.js';
import { scriptPost } from './api.js';
import { clearCachedJobs } from './jobsCache.js';

let auth = readAuth(); // { token, user } — validated server-side on every call
let pinEntry = '';
let pinBusy = false;

function readAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export const getAuth = () => auth;
export const currentUser = () => auth ? auth.user : null;
export const currentPin = () => auth ? auth.pin : null;
export const currentDepartment = () => auth ? auth.department : null;
export const canEditDueDates = () => !!(auth && auth.isDueDateEditor);
export const canManageUsers = () => !!(auth && auth.canManageUsers);
// Only Admin/Manager can mark an entire job complete or assign departments.
export const canMarkJobComplete = () => !!auth && (auth.department === 'Admin' || auth.department === 'Manager');
export const canAssignDepartments = () => !!auth && (auth.department === 'Admin' || auth.department === 'Manager');
export const isAdmin = () => !!auth && auth.department === 'Admin';
// Project notes: Admin, Manager, and Viewer can add one — production-
// department accounts can't (they add department notes instead).
export const canAddProjectNotes = () => !!auth && (auth.department === 'Admin' || auth.department === 'Manager' || auth.department === 'Viewer');
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

export function signOut() {
  localStorage.removeItem(AUTH_KEY);
  clearCachedJobs(); // shared devices shouldn't flash a previous account's data on the next login
  auth = null;
  pinEntry = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('pin-screen').style.display = 'flex';
  document.getElementById('pin-error').textContent = '';
  renderDots();
}

/**
 * Wires up the PIN pad and shows either the PIN screen or the app shell
 * depending on whether a valid session is already cached.
 * @param {() => void} onLogin called once a session is established
 */
export function initAuth(onLogin) {
  document.querySelectorAll('.pin-pad button[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => pinKey(btn.dataset.digit, onLogin));
  });
  document.getElementById('pin-del').addEventListener('click', pinDel);
  document.addEventListener('keydown', e => {
    if (auth) return;
    if (e.key >= '0' && e.key <= '9') pinKey(e.key, onLogin);
    if (e.key === 'Backspace') pinDel();
  });

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
  if (pinBusy || pinEntry.length >= 4) return;
  pinEntry += digit;
  renderDots();
  if (pinEntry.length === 4) submitPin(onLogin);
}

function pinDel() {
  pinEntry = pinEntry.slice(0, -1);
  renderDots();
}

function submitPin(onLogin) {
  pinBusy = true;
  const errorEl = document.getElementById('pin-error');
  errorEl.textContent = 'Verifying…';
  scriptPost({ action: 'login', pin: pinEntry })
    .then(res => {
      pinBusy = false;
      if (!res.ok) {
        errorEl.textContent = res.locked ? 'Too many attempts — try again in 10 minutes.' : 'Incorrect PIN';
        pinEntry = '';
        renderDots();
        return;
      }
      auth = { token: res.token, user: res.user, department: res.department, isDueDateEditor: !!res.isDueDateEditor, canManageUsers: !!res.canManageUsers, pin: pinEntry };
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      pinEntry = '';
      renderDots();
      errorEl.textContent = '';
      document.getElementById('pin-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      onLogin();
    })
    .catch(() => {
      pinBusy = false;
      errorEl.textContent = 'Network error — try again.';
      pinEntry = '';
      renderDots();
    });
}
