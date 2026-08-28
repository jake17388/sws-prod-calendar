import { deleteJobTimeEntry, exportJobTimeLog, fetchJobTimeLog, updateJobTimeEntry } from '../api.js';
import { canEditHoursLog } from '../auth.js';
import { escapeAttr, escapeHtml } from '../lib/html.js';

let entries = null;
let loading = false;
let error = '';
let editingEntryId = '';
let confirmingDeleteEntryId = '';
let exporting = false;
const initialDate = localDateKey(new Date());
let fromDate = initialDate;
let toDate = initialDate;
// Calendar popover, ported from the Job Map day bar: calMonth is the month on
// screen, calPickStart is the first tap of an in-progress range.
let calendarOpen = false;
let calMonth = initialDate;
let calPickStart = '';
const savingEntries = new Set();
const deletingEntries = new Set();
const rowErrors = new Map();

function localDateKey(value) {
  const date = new Date(value);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftDateKey(key, days) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function formatDayLabel(key) {
  return parseDateKey(key).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Today" for the common case, a single date, or an inclusive range.
function dayNavLabel() {
  if (fromDate !== toDate) return `${formatDayLabel(fromDate)} – ${formatDayLabel(toDate)}`;
  return fromDate === localDateKey(new Date()) ? 'Today' : formatDayLabel(fromDate);
}

function downloadExport(result) {
  const bytes = Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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

function dayNavHtml() {
  return `<div class="hours-log-day-nav">
    <button class="hours-log-day-nav-btn hours-log-day-nav-prev" type="button" title="Previous day" aria-label="Previous day" ${loading ? 'disabled' : ''}>&lsaquo;</button>
    <button class="hours-log-day-nav-label" type="button" title="Pick a date or range" aria-haspopup="dialog" aria-expanded="${calendarOpen ? 'true' : 'false'}">${escapeHtml(dayNavLabel())}</button>
    <button class="hours-log-day-nav-btn hours-log-day-nav-next" type="button" title="Next day" aria-label="Next day" ${loading ? 'disabled' : ''}>&rsaquo;</button>
  </div>`;
}

// Range highlighting mirrors the Job Map: the in-progress pick shows as a
// single selected day until the second tap closes the range.
function calendarDayClasses(dateKey, todayKey) {
  const classes = ['hours-log-calendar-day'];
  if (dateKey === todayKey) classes.push('today');
  if (calPickStart) {
    if (dateKey === calPickStart) classes.push('range-start', 'range-end');
  } else {
    if (dateKey === fromDate) classes.push('range-start');
    if (dateKey === toDate) classes.push('range-end');
    if (dateKey > fromDate && dateKey < toDate) classes.push('in-range');
  }
  return classes.join(' ');
}

function calendarGridHtml() {
  const month = parseDateKey(calMonth);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const todayKey = localDateKey(new Date());
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let blank = 0; blank < firstDayOfWeek; blank += 1) cells.push('<span></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = localDateKey(new Date(year, monthIndex, day));
    const selected = dateKey === fromDate || dateKey === toDate || (dateKey > fromDate && dateKey < toDate);
    cells.push(`<button class="${calendarDayClasses(dateKey, todayKey)}" type="button" data-date="${escapeAttr(dateKey)}" aria-label="${escapeAttr(formatDayLabel(dateKey))}" aria-pressed="${selected ? 'true' : 'false'}"${dateKey === todayKey ? ' aria-current="date"' : ''}>${day}</button>`);
  }
  return cells.join('');
}

function calendarHtml() {
  if (!calendarOpen) return '';
  const monthLabel = parseDateKey(calMonth).toLocaleDateString([], { month: 'long', year: 'numeric' });
  return `<div class="hours-log-calendar-backdrop"><section class="hours-log-calendar" role="dialog" aria-modal="true" aria-labelledby="hours-log-calendar-title" aria-describedby="hours-log-calendar-hint" tabindex="-1">
    <div class="hours-log-calendar-header">
      <h2 id="hours-log-calendar-title">${escapeHtml(monthLabel)}</h2>
      <button class="hours-log-calendar-close" type="button" aria-label="Close date picker">&#10005;</button>
    </div>
    <div class="hours-log-calendar-nav">
      <button class="hours-log-calendar-nav-btn hours-log-calendar-prev-month" type="button" title="Previous month" aria-label="Previous month">&lsaquo;</button>
      <button class="hours-log-calendar-today" type="button">Jump to today</button>
      <button class="hours-log-calendar-nav-btn hours-log-calendar-next-month" type="button" title="Next month" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="hours-log-calendar-weekdays" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
    <div class="hours-log-calendar-grid">${calendarGridHtml()}</div>
    <p class="hours-log-calendar-hint" id="hours-log-calendar-hint">Tap a day to start, tap again to set the range (tap the same day twice for a single day).</p>
  </section></div>`;
}

function deletePromptHtml() {
  if (!confirmingDeleteEntryId) return '';
  const deleting = deletingEntries.has(confirmingDeleteEntryId);
  return `<div class="hours-log-dialog-backdrop"><section class="hours-log-dialog" role="dialog" aria-modal="true" aria-labelledby="hours-log-delete-title" aria-describedby="hours-log-delete-description" aria-busy="${deleting ? 'true' : 'false'}" tabindex="-1">
    <h2 id="hours-log-delete-title">Delete this hour log?</h2>
    <p id="hours-log-delete-description">This permanently removes the selected time entry.</p>
    <div class="hours-log-dialog-actions"><button class="hours-log-delete-cancel" type="button" ${deleting ? 'disabled' : ''}>Cancel</button><button class="hours-log-delete-confirm" type="button" aria-label="${deleting ? 'Deleting hour log' : 'Confirm delete'}" ${deleting ? 'disabled' : ''}>${deleting ? 'Deleting…' : 'Confirm'}</button></div>
  </section></div>`;
}

function entryRow(container, entryId) {
  return [...container.querySelectorAll('tr[data-entry-id]')]
    .find(row => row.dataset.entryId === entryId) || null;
}

function focusEntryAction(container, entryId, selector) {
  entryRow(container, entryId)?.querySelector(selector)?.focus();
}

function closeDeletePrompt(container) {
  const entryId = confirmingDeleteEntryId;
  confirmingDeleteEntryId = '';
  paint(container);
  focusEntryAction(container, entryId, '.hours-log-delete');
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
  const entryIndex = entries.findIndex(entry => entry.entryId === entryId);
  const nextEntryId = entries[entryIndex + 1]?.entryId || entries[entryIndex - 1]?.entryId || '';
  let deleted = false;
  deletingEntries.add(entryId);
  paint(container);
  container.querySelector('.hours-log-dialog')?.focus();
  deleteJobTimeEntry(entryId)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not delete entry');
      entries = entries.filter(entry => entry.entryId !== entryId);
      deleted = true;
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
      if (!container.querySelector('.hours-log-shell')) return;
      paint(container);
      if (deleted && nextEntryId) focusEntryAction(container, nextEntryId, '.hours-log-edit');
      else if (deleted) container.querySelector('.hours-log-refresh')?.focus();
      else focusEntryAction(container, entryId, '.hours-log-delete');
    });
}

function shiftSelectedDay(container, delta) {
  if (loading) return;
  fromDate = shiftDateKey(fromDate, delta);
  toDate = fromDate;
  loadEntries(container);
}

function openCalendar(container) {
  calendarOpen = true;
  calPickStart = '';
  calMonth = fromDate;
  paint(container);
  container.querySelector('.hours-log-calendar')?.focus();
}

function closeCalendar(container) {
  calendarOpen = false;
  calPickStart = '';
  paint(container);
  container.querySelector('.hours-log-day-nav-label')?.focus();
}

function shiftCalendarMonth(container, delta) {
  const month = parseDateKey(calMonth);
  month.setDate(1);
  month.setMonth(month.getMonth() + delta);
  calMonth = localDateKey(month);
  paint(container);
  container.querySelector('.hours-log-calendar')?.focus();
}

// First tap starts the range, second tap closes it — reversed picks swap so the
// range is always ordered, and the same day twice means a single day.
function pickCalendarDay(container, dateKey) {
  if (!calPickStart) {
    calPickStart = dateKey;
    paint(container);
    container.querySelector(`.hours-log-calendar-day[data-date="${dateKey}"]`)?.focus();
    return;
  }
  const [from, to] = dateKey < calPickStart ? [dateKey, calPickStart] : [calPickStart, dateKey];
  fromDate = from;
  toDate = to;
  calendarOpen = false;
  calPickStart = '';
  loadEntries(container);
  container.querySelector('.hours-log-day-nav-label')?.focus();
}

function bindCalendar(container) {
  const calendar = container.querySelector('.hours-log-calendar');
  if (!calendar) return;
  container.querySelector('.hours-log-calendar-backdrop').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeCalendar(container);
  });
  container.querySelector('.hours-log-calendar-close').addEventListener('click', () => closeCalendar(container));
  container.querySelector('.hours-log-calendar-prev-month').addEventListener('click', () => shiftCalendarMonth(container, -1));
  container.querySelector('.hours-log-calendar-next-month').addEventListener('click', () => shiftCalendarMonth(container, 1));
  container.querySelector('.hours-log-calendar-today').addEventListener('click', () => {
    calMonth = localDateKey(new Date());
    paint(container);
    container.querySelector('.hours-log-calendar')?.focus();
  });
  container.querySelectorAll('.hours-log-calendar-day').forEach(button => button.addEventListener(
    'click', () => pickCalendarDay(container, button.dataset.date)));
  calendar.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCalendar(container);
      return;
    }
    trapTab(event, calendar);
  });
}

// Shared by both dialogs: keep Tab inside the panel that owns the screen.
function trapTab(event, panel) {
  if (event.key !== 'Tab') return;
  const controls = [...panel.querySelectorAll('button:not(:disabled)')];
  if (!controls.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindHoursLog(container) {
  container.querySelector('.hours-log-refresh').addEventListener('click', () => loadEntries(container));
  container.querySelector('.hours-log-day-nav-prev').addEventListener('click', () => shiftSelectedDay(container, -1));
  container.querySelector('.hours-log-day-nav-next').addEventListener('click', () => shiftSelectedDay(container, 1));
  container.querySelector('.hours-log-day-nav-label').addEventListener('click', () => openCalendar(container));
  bindCalendar(container);
  container.querySelector('.hours-log-export').addEventListener('click', () => {
    if (exporting || loading || !entries?.length) return;
    exporting = true;
    error = '';
    paint(container);
    exportJobTimeLog(fromDate, toDate)
      .then(result => {
        if (!result.success || !result.base64) throw new Error(result.error || 'Could not export hours log');
        downloadExport(result);
      })
      .catch(err => { error = err.message || 'Could not export hours log'; })
      .finally(() => {
        exporting = false;
        if (container.querySelector('.hours-log-shell')) paint(container);
      });
  });
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
    container.querySelector('.hours-log-delete-cancel')?.focus();
  }));
  container.querySelector('.hours-log-delete-cancel')?.addEventListener('click', () => closeDeletePrompt(container));
  container.querySelector('.hours-log-delete-confirm')?.addEventListener('click', () => confirmDelete(container));
  const dialog = container.querySelector('.hours-log-dialog');
  dialog?.addEventListener('keydown', event => {
    const deleting = deletingEntries.has(confirmingDeleteEntryId);
    if (event.key === 'Escape' && !deleting) {
      event.preventDefault();
      closeDeletePrompt(container);
      return;
    }
    trapTab(event, dialog);
  });
}

function paint(container) {
  const backgroundAttrs = confirmingDeleteEntryId || calendarOpen ? 'inert aria-hidden="true"' : '';
  container.innerHTML = `<div class="job-selector-shell hours-log-shell">
    <header class="job-selector-heading" ${backgroundAttrs}>
      <span class="job-selector-eyebrow">Job costing</span>
      <h1>Hours Log</h1>
      <p>Review job-costing time, or use the pencil to correct a job number or timestamp. Every saved edit records who changed it and when.</p>
    </header>
    <section class="job-selector-section hours-log-section" aria-labelledby="hours-log-title" ${backgroundAttrs}>
      <div class="job-selector-section-heading"><div><h2 id="hours-log-title">Time entries</h2><p>${entries === null ? '' : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}</p></div><button class="hours-log-refresh" type="button">Refresh</button></div>
      <div class="hours-log-toolbar" role="group" aria-label="Hours Log date range">
        ${dayNavHtml()}
        <div class="hours-log-toolbar-actions">
          <button class="hours-log-export" type="button" ${loading || exporting || !entries?.length ? 'disabled' : ''}>${exporting ? 'Exporting…' : 'Export to Excel'}</button>
        </div>
      </div>
      <div class="hours-log-status" role="status" aria-live="polite">${escapeHtml(loading ? 'Loading hours…' : error)}</div>
      <div class="hours-log-table-wrap"><table class="hours-log-table">
        <colgroup><col class="hours-log-col-employee"><col class="hours-log-col-job"><col class="hours-log-col-started"><col class="hours-log-col-ended"><col class="hours-log-col-duration"><col class="hours-log-col-source"><col class="hours-log-col-edited"><col class="hours-log-col-actions"></colgroup>
        <thead><tr><th>Employee</th><th>Job</th><th>Started</th><th>Ended</th><th>Duration</th><th>Source</th><th>Last edited</th><th>Actions</th></tr></thead>
        <tbody>${loading ? '' : rowsHtml()}</tbody>
      </table></div>
    </section>
    ${calendarHtml()}
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
  return fetchJobTimeLog(fromDate, toDate)
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
  exporting = false;
  fromDate = localDateKey(new Date());
  toDate = fromDate;
  calendarOpen = false;
  calMonth = fromDate;
  calPickStart = '';
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
