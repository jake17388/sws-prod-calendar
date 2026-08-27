import { fetchJobTimeLog, updateJobTimeEntry } from '../api.js';
import { canEditHoursLog } from '../auth.js';
import { escapeAttr, escapeHtml } from '../lib/html.js';

let entries = null;
let loading = false;
let error = '';
const savingEntries = new Set();

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function dateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inputIso(input, required) {
  const value = String(input.value || '').trim();
  if (!value && !required) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDuration(entry) {
  if (entry.status === 'active') return 'Active';
  if (!Number.isFinite(entry.durationMinutes)) return '—';
  const totalMinutes = Math.max(0, Math.round(entry.durationMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function editedLabel(entry) {
  if (!entry.editedAt) return 'Not edited';
  return `Edited ${formatDate(entry.editedAt)}${entry.editedBy ? ` by ${entry.editedBy}` : ''}`;
}

function editableRowHtml(entry) {
  const saving = savingEntries.has(entry.entryId);
  return `<tr data-entry-id="${escapeAttr(entry.entryId)}" ${saving ? 'aria-busy="true"' : ''}>
    <td><input class="hours-log-input hours-log-employee" aria-label="Employee" maxlength="80" value="${escapeAttr(entry.employee)}" ${saving ? 'disabled' : ''} /><small>${escapeHtml(entry.department)}</small></td>
    <td><input class="hours-log-input hours-log-job-number" aria-label="Job number" inputmode="numeric" maxlength="6" value="${escapeAttr(entry.jobNum)}" ${saving ? 'disabled' : ''} /><input class="hours-log-input hours-log-job-name" aria-label="Job name" maxlength="300" value="${escapeAttr(entry.jobName)}" ${saving ? 'disabled' : ''} /></td>
    <td><input class="hours-log-input hours-log-started" aria-label="Started" type="datetime-local" value="${escapeAttr(dateTimeLocalValue(entry.startedAt))}" ${saving ? 'disabled' : ''} /></td>
    <td><input class="hours-log-input hours-log-ended" aria-label="Ended" type="datetime-local" value="${escapeAttr(dateTimeLocalValue(entry.endedAt))}" ${saving ? 'disabled' : ''} /></td>
    <td><span class="hours-log-duration${entry.status === 'active' ? ' is-active' : ''}">${escapeHtml(formatDuration(entry))}</span><small>${escapeHtml(entry.status === 'active' ? 'Active' : 'Closed')}</small></td>
    <td>${escapeHtml(entry.source === 'assigned' ? 'Assigned' : 'Other')}</td>
    <td class="hours-log-edited">${escapeHtml(editedLabel(entry))}</td>
    <td><button class="hours-log-save" type="button" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save'}</button><small class="hours-log-row-hint" role="status"></small></td>
  </tr>`;
}

function readOnlyRowHtml(entry) {
  return `<tr>
    <td><strong>${escapeHtml(entry.employee)}</strong><small>${escapeHtml(entry.department)}</small></td>
    <td><strong>${escapeHtml(entry.jobNum)}</strong><small>${escapeHtml(entry.jobName)}</small></td>
    <td>${escapeHtml(formatDate(entry.startedAt))}</td>
    <td>${escapeHtml(formatDate(entry.endedAt))}</td>
    <td><span class="hours-log-duration${entry.status === 'active' ? ' is-active' : ''}">${escapeHtml(formatDuration(entry))}</span><small>${escapeHtml(entry.status === 'active' ? 'Active' : 'Closed')}</small></td>
    <td>${escapeHtml(entry.source === 'assigned' ? 'Assigned' : 'Other')}</td>
    <td class="hours-log-edited">${escapeHtml(editedLabel(entry))}</td>
    <td></td>
  </tr>`;
}

function rowsHtml() {
  if (!entries || !entries.length) {
    return '<tr><td class="hours-log-empty" colspan="8">No job-costing time has been logged yet.</td></tr>';
  }
  return entries.map(entry => canEditHoursLog() ? editableRowHtml(entry) : readOnlyRowHtml(entry)).join('');
}

function saveEntry(container, row) {
  const entryId = row.dataset.entryId;
  const startedAt = inputIso(row.querySelector('.hours-log-started'), true);
  const endedAt = inputIso(row.querySelector('.hours-log-ended'), false);
  const hint = row.querySelector('.hours-log-row-hint');
  if (!startedAt || endedAt === null) {
    hint.textContent = 'Enter valid start and end times';
    return;
  }
  const patch = {
    employee: row.querySelector('.hours-log-employee').value.trim(),
    jobNum: row.querySelector('.hours-log-job-number').value.trim(),
    jobName: row.querySelector('.hours-log-job-name').value.trim(),
    startedAt,
    endedAt,
  };
  savingEntries.add(entryId);
  paint(container);
  updateJobTimeEntry(entryId, patch)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not save entry');
      entries = entries.map(entry => entry.entryId === entryId ? result.entry : entry);
    })
    .catch(err => { error = err.message || 'Could not save entry'; })
    .finally(() => {
      savingEntries.delete(entryId);
      if (container.querySelector('.hours-log-shell')) paint(container);
    });
}

function bindHoursLog(container) {
  container.querySelector('.hours-log-refresh').addEventListener('click', () => loadEntries(container));
  container.querySelectorAll('.hours-log-save').forEach(button => {
    button.addEventListener('click', () => saveEntry(container, button.closest('tr')));
  });
}

function paint(container) {
  container.innerHTML = `<div class="job-selector-shell hours-log-shell">
    <header class="job-selector-heading">
      <span class="job-selector-eyebrow">Job costing</span>
      <h1>Hours Log</h1>
      <p>Correct employee, job, and time details. Every saved edit records who changed it and when.</p>
    </header>
    <section class="job-selector-section hours-log-section" aria-labelledby="hours-log-title">
      <div class="job-selector-section-heading">
        <h2 id="hours-log-title">Time entries</h2>
        <button class="hours-log-refresh" type="button">Refresh</button>
      </div>
      <div class="hours-log-status" role="status" aria-live="polite">${escapeHtml(loading ? 'Loading hours…' : error)}</div>
      <div class="hours-log-table-wrap">
        <table class="hours-log-table">
          <thead><tr><th>Employee</th><th>Job</th><th>Started</th><th>Ended</th><th>Duration</th><th>Source</th><th>Last edited</th><th>Actions</th></tr></thead>
          <tbody>${loading ? '' : rowsHtml()}</tbody>
        </table>
      </div>
    </section>
  </div>`;
  bindHoursLog(container);
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
  savingEntries.clear();
}

export function renderHoursLog(container) {
  paint(container);
  if (entries === null && !loading) loadEntries(container);
}

export function hoursLogRangeLabel() {
  return 'Hours Log';
}
