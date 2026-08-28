import { deleteJobTimeEntry, fetchJobTimeLog, updateJobTimeEntry } from '../api.js';
import { canEditHoursLog } from '../auth.js';
import { escapeAttr, escapeHtml } from '../lib/html.js';

let entries = null;
let loading = false;
let error = '';
let editingEntryId = '';
let confirmingDeleteEntryId = '';
const savingEntries = new Set();
const deletingEntries = new Set();
const rowErrors = new Map();

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

function durationCell(entry) {
  return `<span class="hours-log-duration${entry.status === 'active' ? ' is-active' : ''}">${escapeHtml(formatDuration(entry))}</span><small>${escapeHtml(entry.status === 'active' ? 'Active' : 'Closed')}</small>`;
}

function isCostingEntry(entry) {
  return String(entry.source || '').startsWith('costing_button:');
}

function sourceLabel(entry) {
  if (entry.source === 'assigned') return 'Assigned';
  if (isCostingEntry(entry)) return 'Costing button';
  return 'Other';
}

function editIcon() {
  return '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M4 20h4l11-11-4-4L4 16v4Zm13.7-13.7 1-1a1.4 1.4 0 0 1 2 2l-1 1-2-2Z" fill="currentColor"/></svg>';
}

function editableRowHtml(entry) {
  const saving = savingEntries.has(entry.entryId);
  const jobEditor = isCostingEntry(entry)
    ? `<strong>${escapeHtml(entry.jobName)}</strong><small>Not job specific</small>`
    : `<input class="hours-log-input hours-log-job-number" aria-label="Job number" inputmode="numeric" maxlength="6" value="${escapeAttr(entry.jobNum)}" ${saving ? 'disabled' : ''} /><small>${escapeHtml(entry.jobName)}</small>`;
  return `<tr data-entry-id="${escapeAttr(entry.entryId)}" ${saving ? 'aria-busy="true"' : ''}>
    <td data-label="Employee"><strong>${escapeHtml(entry.employee)}</strong><small>${escapeHtml(entry.department)}</small></td>
    <td data-label="Job">${jobEditor}</td>
    <td data-label="Started"><input class="hours-log-input hours-log-started" aria-label="Started" type="datetime-local" value="${escapeAttr(dateTimeLocalValue(entry.startedAt))}" ${saving ? 'disabled' : ''} /></td>
    <td data-label="Ended"><input class="hours-log-input hours-log-ended" aria-label="Ended" type="datetime-local" value="${escapeAttr(dateTimeLocalValue(entry.endedAt))}" ${saving ? 'disabled' : ''} /></td>
    <td data-label="Duration">${durationCell(entry)}</td>
    <td data-label="Source">${escapeHtml(sourceLabel(entry))}</td>
    <td class="hours-log-edited" data-label="Last edited">${escapeHtml(editedLabel(entry))}</td>
    <td data-label="Actions"><div class="hours-log-edit-actions"><button class="hours-log-save" type="button" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save'}</button><button class="hours-log-cancel" type="button" ${saving ? 'disabled' : ''}>Cancel</button><button class="hours-log-delete" type="button" ${saving ? 'disabled' : ''}>Delete</button></div><small class="hours-log-row-hint" role="status">${escapeHtml(rowErrors.get(entry.entryId) || '')}</small></td>
  </tr>`;
}

function readOnlyRowHtml(entry) {
  const canEdit = canEditHoursLog();
  const jobCell = isCostingEntry(entry)
    ? `<strong>${escapeHtml(entry.jobName)}</strong><small>Not job specific</small>`
    : `<strong>${escapeHtml(entry.jobNum)}</strong><small>${escapeHtml(entry.jobName)}</small>`;
  return `<tr data-entry-id="${escapeAttr(entry.entryId)}">
    <td data-label="Employee"><strong>${escapeHtml(entry.employee)}</strong><small>${escapeHtml(entry.department)}</small></td>
    <td data-label="Job">${jobCell}</td>
    <td data-label="Started">${escapeHtml(formatDate(entry.startedAt))}</td>
    <td data-label="Ended">${escapeHtml(formatDate(entry.endedAt))}</td>
    <td data-label="Duration">${durationCell(entry)}</td>
    <td data-label="Source">${escapeHtml(sourceLabel(entry))}</td>
    <td class="hours-log-edited" data-label="Last edited">${escapeHtml(editedLabel(entry))}</td>
    <td data-label="Actions">${canEdit ? `<button class="hours-log-edit" type="button" aria-label="Edit hour log">${editIcon()}</button>` : ''}</td>
  </tr>`;
}

function rowsHtml() {
  if (!entries || !entries.length) {
    return '<tr><td class="hours-log-empty" colspan="8">No job-costing time has been logged yet.</td></tr>';
  }
  return entries.map(entry => entry.entryId === editingEntryId ? editableRowHtml(entry) : readOnlyRowHtml(entry)).join('');
}

function deletePromptHtml() {
  if (!confirmingDeleteEntryId) return '';
  const deleting = deletingEntries.has(confirmingDeleteEntryId);
  return `<div class="hours-log-dialog-backdrop"><section class="hours-log-dialog" role="dialog" aria-modal="true" aria-labelledby="hours-log-delete-title">
    <h2 id="hours-log-delete-title">Delete this hour log?</h2>
    <p>This permanently removes the selected time entry.</p>
    <div class="hours-log-dialog-actions"><button class="hours-log-delete-cancel" type="button" ${deleting ? 'disabled' : ''}>Cancel</button><button class="hours-log-delete-confirm" type="button" ${deleting ? 'disabled' : ''}>Confirm</button></div>
  </section></div>`;
}

function saveEntry(container, row) {
  const entryId = row.dataset.entryId;
  const startedAt = inputIso(row.querySelector('.hours-log-started'), true);
  const endedAt = inputIso(row.querySelector('.hours-log-ended'), false);
  if (!startedAt || endedAt === null) {
    rowErrors.set(entryId, 'Enter valid start and end times');
    paint(container);
    return;
  }
  const jobNum = row.querySelector('.hours-log-job-number')?.value.trim() || '';
  rowErrors.delete(entryId);
  savingEntries.add(entryId);
  paint(container);
  updateJobTimeEntry(entryId, { jobNum, startedAt, endedAt })
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not save entry');
      entries = entries.map(entry => entry.entryId === entryId ? result.entry : entry);
      editingEntryId = '';
    })
    .catch(err => { rowErrors.set(entryId, err.message || 'Could not save entry'); })
    .finally(() => {
      savingEntries.delete(entryId);
      if (container.querySelector('.hours-log-shell')) paint(container);
    });
}

function confirmDelete(container) {
  const entryId = confirmingDeleteEntryId;
  if (!entryId) return;
  deletingEntries.add(entryId);
  paint(container);
  deleteJobTimeEntry(entryId)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not delete entry');
      entries = entries.filter(entry => entry.entryId !== entryId);
      editingEntryId = '';
      confirmingDeleteEntryId = '';
      rowErrors.delete(entryId);
    })
    .catch(err => {
      error = err.message || 'Could not delete entry';
      confirmingDeleteEntryId = '';
    })
    .finally(() => {
      deletingEntries.delete(entryId);
      if (container.querySelector('.hours-log-shell')) paint(container);
    });
}

function bindHoursLog(container) {
  container.querySelector('.hours-log-refresh').addEventListener('click', () => loadEntries(container));
  container.querySelectorAll('.hours-log-edit').forEach(button => button.addEventListener('click', () => {
    editingEntryId = button.closest('tr').dataset.entryId;
    rowErrors.clear();
    paint(container);
  }));
  container.querySelectorAll('.hours-log-save').forEach(button => button.addEventListener('click', () => saveEntry(container, button.closest('tr'))));
  container.querySelectorAll('.hours-log-cancel').forEach(button => button.addEventListener('click', () => {
    editingEntryId = '';
    rowErrors.clear();
    paint(container);
  }));
  container.querySelectorAll('.hours-log-delete').forEach(button => button.addEventListener('click', () => {
    confirmingDeleteEntryId = button.closest('tr').dataset.entryId;
    paint(container);
  }));
  container.querySelector('.hours-log-delete-cancel')?.addEventListener('click', () => {
    confirmingDeleteEntryId = '';
    paint(container);
  });
  container.querySelector('.hours-log-delete-confirm')?.addEventListener('click', () => confirmDelete(container));
}

function paint(container) {
  container.innerHTML = `<div class="job-selector-shell hours-log-shell">
    <header class="job-selector-heading">
      <span class="job-selector-eyebrow">Job costing</span>
      <h1>Hours Log</h1>
      <p>Review job-costing time, or use the pencil to correct a job number or timestamp. Every saved edit records who changed it and when.</p>
    </header>
    <section class="job-selector-section hours-log-section" aria-labelledby="hours-log-title">
      <div class="job-selector-section-heading"><h2 id="hours-log-title">Time entries</h2><button class="hours-log-refresh" type="button">Refresh</button></div>
      <div class="hours-log-status" role="status" aria-live="polite">${escapeHtml(loading ? 'Loading hours…' : error)}</div>
      <div class="hours-log-table-wrap"><table class="hours-log-table">
        <colgroup><col class="hours-log-col-employee"><col class="hours-log-col-job"><col class="hours-log-col-started"><col class="hours-log-col-ended"><col class="hours-log-col-duration"><col class="hours-log-col-source"><col class="hours-log-col-edited"><col class="hours-log-col-actions"></colgroup>
        <thead><tr><th>Employee</th><th>Job</th><th>Started</th><th>Ended</th><th>Duration</th><th>Source</th><th>Last edited</th><th>Actions</th></tr></thead>
        <tbody>${loading ? '' : rowsHtml()}</tbody>
      </table></div>
    </section>
    ${deletePromptHtml()}
  </div>`;
  bindHoursLog(container);
}

function loadEntries(container) {
  if (loading) return;
  loading = true;
  error = '';
  editingEntryId = '';
  confirmingDeleteEntryId = '';
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
  editingEntryId = '';
  confirmingDeleteEntryId = '';
  savingEntries.clear();
  deletingEntries.clear();
  rowErrors.clear();
}

export function renderHoursLog(container) {
  paint(container);
  if (entries === null && !loading) loadEntries(container);
}

export function hoursLogRangeLabel() {
  return 'Hours Log';
}
