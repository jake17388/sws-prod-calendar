import { fetchSquarecoilStatus, refreshSquarecoilFilesNow } from '../api.js';
import { currentDepartment } from '../auth.js';
import { showToast } from '../toast.js';

function isAdmin() {
  return currentDepartment() === 'Admin';
}

function setHint(text) {
  document.getElementById('squarecoil-hint').textContent = text;
}

function renderStatus(status) {
  const connected = !!status.connected;
  const statusText = document.getElementById('squarecoil-status-text');
  statusText.textContent = connected ? 'Connected' : 'Not configured';
  statusText.classList.toggle('connected', connected);
  document.getElementById('squarecoil-refresh-btn').hidden = !connected;
  if (!connected) setHint('Add SQUARECOIL_USERNAME and SQUARECOIL_PASSWORD in Apps Script properties.');
}

export function refreshSquarecoilSettingsUI() {
  const section = document.getElementById('squarecoil-settings-section');
  const admin = isAdmin();
  section.hidden = !admin;
  if (!admin) return Promise.resolve();

  setHint('');
  return fetchSquarecoilStatus()
    .then(renderStatus)
    .catch(() => setHint('Could not load Squarecoil status'));
}

function handleRefresh() {
  const button = document.getElementById('squarecoil-refresh-btn');
  setHint('Refreshing Production Files from Squarecoil…');
  button.disabled = true;
  return refreshSquarecoilFilesNow()
    .then(res => {
      if (!res.success) { setHint(res.error || 'Refresh failed'); return; }
      setHint('Refreshed');
      showToast('Production Files refreshed');
      setTimeout(() => setHint(''), 1500);
    })
    .catch(() => setHint('Network error — try again'))
    .finally(() => { button.disabled = false; });
}

export function initSquarecoilSettings() {
  document.getElementById('squarecoil-refresh-btn').addEventListener('click', handleRefresh);
}
