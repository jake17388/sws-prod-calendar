import { fetchDropboxStatus, fetchDropboxAuthUrl, setDropboxCredentials, disconnectDropbox, refreshDropboxProofsNow, debugDropboxProof } from '../api.js';
import { currentDepartment } from '../auth.js';
import { showToast } from '../toast.js';

function isAdmin() {
  return currentDepartment() === 'Admin';
}

function setHint(text) {
  document.getElementById('dropbox-hint').textContent = text;
}

function renderStatus(status) {
  const statusText = document.getElementById('dropbox-status-text');
  statusText.textContent = status.connected ? 'Connected' : (status.hasCredentials ? 'Not connected' : 'Not set up');

  document.getElementById('dropbox-connect-btn').hidden = !status.hasCredentials || status.connected;
  document.getElementById('dropbox-refresh-btn').hidden = !status.connected;
  document.getElementById('dropbox-disconnect-btn').hidden = !status.connected;
}

// Called every time Settings opens — Dropbox connection status can change
// out from under this tab (e.g. the Admin approved access in the OAuth tab
// this flow opens, then came back here), so it's never cached client-side.
export function refreshDropboxSettingsUI() {
  const row = document.getElementById('dropbox-settings-row');
  const admin = isAdmin();
  row.hidden = !admin;
  document.getElementById('dropbox-credentials-fields').hidden = !admin;
  document.getElementById('dropbox-save-credentials-btn').hidden = !admin;
  document.getElementById('dropbox-debug-fields').hidden = !admin;
  document.getElementById('dropbox-debug-btn').hidden = !admin;
  if (!admin) return;

  setHint('');
  fetchDropboxStatus()
    .then(status => renderStatus(status))
    .catch(() => setHint('Could not load Dropbox status'));
}

function handleSaveCredentials() {
  const appKey = document.getElementById('dropbox-app-key').value.trim();
  const appSecret = document.getElementById('dropbox-app-secret').value.trim();
  if (!appKey || !appSecret) { setHint('App key and secret are both required'); return; }
  setHint('Saving…');
  setDropboxCredentials(appKey, appSecret)
    .then(res => {
      if (!res.success) { setHint(res.error || 'Failed to save'); return; }
      document.getElementById('dropbox-app-key').value = '';
      document.getElementById('dropbox-app-secret').value = '';
      setHint('Saved');
      refreshDropboxSettingsUI();
    })
    .catch(() => setHint('Network error — try again'));
}

function handleConnect() {
  setHint('Opening Dropbox…');
  fetchDropboxAuthUrl()
    .then(res => {
      if (!res.url) { setHint(res.error || 'Failed to start Dropbox connection'); return; }
      window.open(res.url, '_blank');
      setHint('Approve access in the new tab, then reopen Settings here.');
    })
    .catch(() => setHint('Network error — try again'));
}

function handleRefresh() {
  setHint('Refreshing proofs from Dropbox…');
  refreshDropboxProofsNow()
    .then(res => {
      if (!res.success) { setHint(res.error || 'Refresh failed'); return; }
      setHint('Refreshed');
      showToast('Dropbox proofs refreshed');
      setTimeout(() => setHint(''), 1500);
    })
    .catch(() => setHint('Network error — try again'));
}

function handleDisconnect() {
  if (!confirm('Disconnect Dropbox? Proofs will show "No File Available" until reconnected.')) return;
  setHint('Disconnecting…');
  disconnectDropbox()
    .then(res => {
      if (!res.success) { setHint(res.error || 'Failed to disconnect'); return; }
      setHint('');
      refreshDropboxSettingsUI();
      showToast('Dropbox disconnected');
    })
    .catch(() => setHint('Network error — try again'));
}

// Retraces the Dropbox folder/Proofs-subfolder/PDF lookup for one job number
// step by step and dumps the raw result — for tracking down why a specific
// job isn't matching (folder-naming conventions in the Dropbox archive
// aren't fully consistent).
function handleDebug() {
  const jobNum = document.getElementById('dropbox-debug-jobnum').value.trim();
  const output = document.getElementById('dropbox-debug-output');
  if (!jobNum) { setHint('Enter a job number first'); return; }
  output.hidden = false;
  output.textContent = 'Looking up…';
  debugDropboxProof(jobNum)
    .then(res => { output.textContent = JSON.stringify(res, null, 2); })
    .catch(() => { output.textContent = 'Network error — try again'; });
}

export function initDropboxSettings() {
  document.getElementById('dropbox-save-credentials-btn').addEventListener('click', handleSaveCredentials);
  document.getElementById('dropbox-connect-btn').addEventListener('click', handleConnect);
  document.getElementById('dropbox-refresh-btn').addEventListener('click', handleRefresh);
  document.getElementById('dropbox-disconnect-btn').addEventListener('click', handleDisconnect);
  document.getElementById('dropbox-debug-btn').addEventListener('click', handleDebug);
}
