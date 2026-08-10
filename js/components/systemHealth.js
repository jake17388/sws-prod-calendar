import { fetchSystemHealth } from '../api.js';
import { isAdmin } from '../auth.js';

function formatTime(value) {
  if (!value) return 'No successful backup recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function renderHealth(health) {
  const pill = document.getElementById('system-health-status');
  pill.textContent = health.healthy ? 'Healthy' : 'Needs attention';
  pill.classList.toggle('connected', health.healthy);
  document.getElementById('system-health-backup').textContent = health.backup.current
    ? `Current — ${formatTime(health.backup.lastAt)}`
    : formatTime(health.backup.lastAt);
  document.getElementById('system-health-trigger').textContent = health.backup.triggerInstalled ? 'Installed' : 'Missing';
  document.getElementById('system-health-tracking').textContent = health.trackingConfigured ? 'Connected' : 'Not configured';
  document.getElementById('system-health-failure').textContent = health.lastFailure
    ? `${health.lastFailure.area}: ${health.lastFailure.message}`
    : 'None';
}

export function refreshSystemHealthUI() {
  const section = document.getElementById('system-health-section');
  section.hidden = !isAdmin();
  if (!isAdmin()) return Promise.resolve();
  document.getElementById('system-health-status').textContent = 'Checking…';
  return fetchSystemHealth()
    .then(renderHealth)
    .catch(() => {
      document.getElementById('system-health-status').textContent = 'Unavailable';
      document.getElementById('system-health-failure').textContent = 'Could not reach the backend';
    });
}

export function initSystemHealth() {
  document.getElementById('system-health-refresh').addEventListener('click', refreshSystemHealthUI);
}
