import { fetchUsers, addUser as addUserApi, updateUser as updateUserApi, deleteUser as deleteUserApi, revokeUserSessions as revokeUserSessionsApi } from '../api.js';
import { DEPARTMENTS, PM_BLOCKED_DEPARTMENTS } from '../config.js';
import { currentDepartment, updateAuthProfile } from '../auth.js';
import { showToast } from '../toast.js';
import { setHeaderDimmed } from '../headerDim.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';

let users = [];
let selectedUser = null;
let selectedRow = null;
let userActionsTrigger = null;

// Mirrors Code.js's canManageDepartment — the server is the source of truth
// for what's actually allowed; this only decides whether a row renders
// editable or read-only.
function canManageDepartment(actorDept, targetDept) {
  if (actorDept === 'Admin') return true;
  if (actorDept === 'Manager') return PM_BLOCKED_DEPARTMENTS.indexOf(targetDept) === -1;
  return false;
}

function availableDepartments(actorDept) {
  return actorDept === 'Admin' ? DEPARTMENTS : DEPARTMENTS.filter(d => PM_BLOCKED_DEPARTMENTS.indexOf(d) === -1);
}

function departmentOptionsHtml(actorDept, selected) {
  return availableDepartments(actorDept)
    .map(d => `<option value="${escapeAttr(d)}" ${d === selected ? 'selected' : ''}>${escapeHtml(d)}</option>`)
    .join('');
}

function showRowHint(row, text, isError) {
  const hint = row.querySelector('.user-row-hint');
  hint.textContent = text;
  hint.classList.toggle('error', !!isError);
  if (!isError) setTimeout(() => { hint.textContent = ''; }, 1500);
}

function renderLockedRow(user) {
  const row = document.createElement('div');
  row.className = 'user-row user-row-locked';
  row.innerHTML = `
    <span class="user-row-name">${escapeHtml(user.name)}</span>
    <span class="user-row-dept">${escapeHtml(user.department)}</span>
    <span class="user-row-pin user-row-pin-hidden">••••••</span>
    <span class="user-row-lock" title="You don't have permission to edit this account">&#128274;</span>
  `;
  return row;
}

function renderEditableRow(user, actorDept) {
  const row = document.createElement('div');
  row.className = 'user-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${user.name}, ${user.department}. Open user options.`);
  const adminCanSeePins = currentDepartment() === 'Admin';
  const adminCanEditNames = actorDept === 'Admin';
  const currentPin = adminCanSeePins && typeof user.pin === 'string' ? user.pin : '';
  const pinType = adminCanSeePins ? 'text' : 'password';
  row.innerHTML = `
    <input type="text" class="user-row-name" value="${escapeAttr(user.name)}" ${adminCanEditNames ? '' : 'readonly'} title="${adminCanEditNames ? 'Edit account name' : 'Only an Admin can change account names'}" />
    <select class="user-row-dept">${departmentOptionsHtml(actorDept, user.department)}</select>
    <input type="${pinType}" class="user-row-pin" inputmode="numeric" maxlength="6" value="${escapeAttr(currentPin)}" placeholder="${adminCanSeePins ? 'Unavailable — reset PIN' : 'New PIN'}" title="${adminCanSeePins ? 'Current PIN; edit to reset it' : 'Enter a new 6-digit PIN'}" autocomplete="off" />
    <span class="user-row-actions">
      <button class="user-row-open" type="button" aria-label="Open options for ${escapeAttr(user.name)}">•••</button>
      <button class="user-row-delete" aria-label="Delete user">&times;</button>
    </span>
    <span class="user-row-hint"></span>
  `;

  if (adminCanEditNames) {
    row.querySelector('.user-row-name').addEventListener('change', e => {
      const name = e.target.value.trim();
      if (!name) { e.target.value = user.name; return; }
      updateUserApi(user.id, { name }).then(res => {
        if (!res.success) { showRowHint(row, res.error || 'Failed to save', true); e.target.value = user.name; return; }
        user.name = res.user.name;
        showRowHint(row, 'Saved');
      }).catch(() => { e.target.value = user.name; showRowHint(row, 'Network error — try again', true); });
    });
  }

  row.querySelector('.user-row-dept').addEventListener('change', e => {
    const department = e.target.value;
    updateUserApi(user.id, { department }).then(res => {
      if (!res.success) { showRowHint(row, res.error || 'Failed to save', true); e.target.value = user.department; return; }
      user.department = res.user.department;
      renderList();
    }).catch(() => { e.target.value = user.department; showRowHint(row, 'Network error — try again', true); });
  });

  row.querySelector('.user-row-pin').addEventListener('change', e => {
    const pin = e.target.value.trim();
    if (!pin) return;
    if (!/^\d{6}$/.test(pin)) {
      showRowHint(row, 'PIN must be 6 digits', true);
      e.target.value = adminCanSeePins ? pin : '';
      if (adminCanSeePins) user.pin = pin;
      return;
    }
    updateUserApi(user.id, { pin }).then(res => {
      if (!res.success) {
        showRowHint(row, res.error || 'Failed to save', true);
        e.target.value = '';
        return;
      }
      if (adminCanSeePins && res.user && res.user.pin) {
        user.pin = res.user.pin;
        e.target.value = res.user.pin;
      } else {
        e.target.value = '';
      }
      if (res.token) updateAuthProfile({ token: res.token });
      showRowHint(row, 'PIN updated');
    }).catch(() => { e.target.value = ''; showRowHint(row, 'Network error — try again', true); });
  });

  row.querySelector('.user-row-open').addEventListener('click', e => openUserActions(user, row, e.currentTarget));
  row.addEventListener('click', e => {
    if (e.target.closest('input, select, button')) return;
    openUserActions(user, row, row);
  });
  row.addEventListener('keydown', e => {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    openUserActions(user, row, row);
  });

  row.querySelector('.user-row-delete').addEventListener('click', () => {
    if (!confirm(`Remove ${user.name}? This can't be undone.`)) return;
    deleteUserApi(user.id).then(res => {
      if (!res.success) { showRowHint(row, res.error || 'Failed to delete', true); showToast(res.error || 'Failed to delete user', 'error'); return; }
      users = users.filter(u => u.id !== user.id);
      renderList();
      showToast(`${user.name} removed`);
    }).catch(() => showRowHint(row, 'Network error — try again', true));
  });

  return row;
}

function openUserActions(user, row, trigger) {
  selectedUser = user;
  selectedRow = row;
  userActionsTrigger = trigger;
  document.getElementById('user-actions-title').textContent = user.name;
  document.getElementById('user-actions-department').textContent = user.department;
  document.getElementById('user-actions-hint').textContent = '';
  const dialog = document.getElementById('user-actions-dialog');
  dialog.hidden = false;
  document.getElementById('user-actions-revoke').focus();
}

function closeUserActions() {
  document.getElementById('user-actions-dialog').hidden = true;
  selectedUser = null;
  selectedRow = null;
  if (userActionsTrigger && document.contains(userActionsTrigger)) userActionsTrigger.focus();
  userActionsTrigger = null;
}

function handleRevokeSessions() {
  if (!selectedUser) return;
  const user = selectedUser;
  const row = selectedRow;
  const button = document.getElementById('user-actions-revoke');
  const hint = document.getElementById('user-actions-hint');
  button.disabled = true;
  hint.textContent = 'Revoking…';
  revokeUserSessionsApi(user.id)
    .then(res => {
      if (!res.success) {
        hint.textContent = res.error || 'Failed to revoke sessions';
        return;
      }
      closeUserActions();
      if (row) showRowHint(row, 'Sessions revoked');
      showToast(`${user.name} signed out on all devices`);
    })
    .catch(() => { hint.textContent = 'Network error — try again'; })
    .finally(() => { button.disabled = false; });
}

function renderList() {
  const actorDept = currentDepartment();
  const list = document.getElementById('user-mgmt-list');
  list.innerHTML = '';
  users
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(user => {
      list.appendChild(canManageDepartment(actorDept, user.department) ? renderEditableRow(user, actorDept) : renderLockedRow(user));
    });
  if (!users.length) {
    const empty = document.createElement('div');
    empty.className = 'user-mgmt-empty';
    empty.textContent = 'No users to show.';
    list.appendChild(empty);
  }
}

function resetAddForm() {
  const actorDept = currentDepartment();
  document.getElementById('user-add-name').value = '';
  document.getElementById('user-add-pin').value = '';
  document.getElementById('user-add-dept').innerHTML = departmentOptionsHtml(actorDept);
  document.getElementById('user-add-hint').textContent = '';
}

function handleAddUser() {
  const name = document.getElementById('user-add-name').value.trim();
  const department = document.getElementById('user-add-dept').value;
  const pin = document.getElementById('user-add-pin').value.trim();
  const hint = document.getElementById('user-add-hint');
  if (!name) { hint.textContent = 'Name is required'; return; }
  if (!/^\d{6}$/.test(pin)) { hint.textContent = 'PIN must be 6 digits'; return; }
  hint.textContent = 'Adding…';
  addUserApi(name, department, pin).then(res => {
    if (!res.success) { hint.textContent = res.error || 'Failed to add user'; showToast(res.error || 'Failed to add user', 'error'); return; }
    users.push(res.user);
    resetAddForm();
    renderList();
    showToast(`${res.user.name} added`);
  }).catch(() => { hint.textContent = 'Network error — try again'; showToast('Failed to add user', 'error'); });
}

export function openUserManagement() {
  document.getElementById('user-mgmt-overlay').classList.add('open');
  setHeaderDimmed(true);
  document.getElementById('user-mgmt-list').innerHTML = '<div class="user-mgmt-empty">Loading…</div>';
  resetAddForm();
  fetchUsers()
    .then(list => { users = list; renderList(); })
    .catch(() => { document.getElementById('user-mgmt-list').innerHTML = '<div class="user-mgmt-empty">Failed to load users</div>'; });
}

export function closeUserManagement() {
  if (!document.getElementById('user-actions-dialog').hidden) closeUserActions();
  document.getElementById('user-mgmt-overlay').classList.remove('open');
  setHeaderDimmed(false);
}

export function initUserManagement() {
  document.getElementById('user-mgmt-close').addEventListener('click', closeUserManagement);
  document.getElementById('user-mgmt-overlay').addEventListener('click', e => {
    if (e.target.id === 'user-mgmt-overlay') closeUserManagement();
  });
  document.getElementById('user-add-btn').addEventListener('click', handleAddUser);
  document.getElementById('user-add-pin').addEventListener('keydown', e => { if (e.key === 'Enter') handleAddUser(); });
  document.getElementById('user-actions-revoke').addEventListener('click', handleRevokeSessions);
  document.getElementById('user-actions-cancel').addEventListener('click', closeUserActions);
  document.getElementById('user-actions-dialog').addEventListener('click', e => {
    if (e.target.id === 'user-actions-dialog') closeUserActions();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('user-actions-dialog').hidden) closeUserActions();
  });
}
