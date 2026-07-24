import { fetchDropboxStatus, fetchDropboxAuthUrl, setDropboxCredentials, disconnectDropbox, refreshDropboxProofsNow } from '../api.js';
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

export function initDropboxSettings() {
  document.getElementById('dropbox-save-credentials-btn').addEventListener('click', handleSaveCredentials);
  document.getElementById('dropbox-connect-btn').addEventListener('click', handleConnect);
  document.getElementById('dropbox-refresh-btn').addEventListener('click', handleRefresh);
  document.getElementById('dropbox-disconnect-btn').addEventListener('click', handleDisconnect);
}
