import { fetchJobTimeLog } from '../api.js';
import { escapeHtml } from '../lib/html.js';

let entries = null;
let loading = false;
let error = '';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(entry) {
  if (entry.status === 'active') return 'Active';
  if (!Number.isFinite(entry.durationMinutes)) return '—';
  const totalMinutes = Math.max(0, Math.round(entry.durationMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function rowsHtml() {
  if (!entries || !entries.length) {
    return '<tr><td class="hours-log-empty" colspan="7">No job-costing time has been logged yet.</td></tr>';
  }
  return entries.map(entry => `<tr>
    <td><strong>${escapeHtml(entry.employee)}</strong><small>${escapeHtml(entry.department)}</small></td>
    <td><strong>${escapeHtml(entry.jobNum)}</strong><small>${escapeHtml(entry.jobName)}</small></td>
    <td>${escapeHtml(formatDate(entry.startedAt))}</td>
    <td>${escapeHtml(formatDate(entry.endedAt))}</td>
    <td><span class="hours-log-duration${entry.status === 'active' ? ' is-active' : ''}">${escapeHtml(formatDuration(entry))}</span></td>
    <td>${escapeHtml(entry.source === 'assigned' ? 'Assigned' : 'Other')}</td>
    <td>${escapeHtml(entry.status === 'active' ? 'Active' : 'Closed')}</td>
  </tr>`).join('');
}

function paint(container) {
  container.innerHTML = `<div class="job-selector-shell hours-log-shell">
    <header class="job-selector-heading">
      <span class="job-selector-eyebrow">Job costing</span>
      <h1>Hours Log</h1>
      <p>Read-only time entries recorded by the Job Selector.</p>
    </header>
    <section class="job-selector-section hours-log-section" aria-labelledby="hours-log-title">
      <div class="job-selector-section-heading">
        <h2 id="hours-log-title">Time entries</h2>
        <button class="hours-log-refresh" type="button">Refresh</button>
      </div>
      <div class="hours-log-status" role="status" aria-live="polite">${escapeHtml(loading ? 'Loading hours…' : error)}</div>
      <div class="hours-log-table-wrap">
        <table class="hours-log-table">
          <thead><tr><th>Employee</th><th>Job</th><th>Started</th><th>Ended</th><th>Duration</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>${loading || error ? '' : rowsHtml()}</tbody>
        </table>
      </div>
    </section>
  </div>`;
  container.querySelector('.hours-log-refresh').addEventListener('click', () => loadEntries(container));
}

function loadEntries(container) {
  if (loading) return;
  loading = true;
  error = '';
  paint(container);
  fetchJobTimeLog()
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not load hours log');
      entries = result.entries || [];
    })
    .catch(err => { error = err.message || 'Could not load hours log'; })
    .finally(() => {
      loading = false;
      if (container.querySelector('.hours-log-shell')) paint(container);
    });
}

export function resetHoursLog() {
  entries = null;
  loading = false;
  error = '';
}

export function renderHoursLog(container) {
  paint(container);
  if (entries === null && !loading) loadEntries(container);
}

export function hoursLogRangeLabel() {
  return 'Hours Log';
}
