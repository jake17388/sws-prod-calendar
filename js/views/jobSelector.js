import { fetchJobTimeStatus, lookupSquarecoilJob, saveJobTimeNote, startJobTime, stopJobTime } from '../api.js';
import { currentDepartment } from '../auth.js';
import { selectableJobSelectorJobs } from '../jobSelectorModel.mjs';
import { escapeAttr, escapeHtml } from '../lib/html.js';
import { showToast } from '../toast.js';

let activeEntries = [];
let statusLoaded = false;
let statusPromise = null;
let lookupResult = null;
let actionBusy = false;
let statusRevision = 0;

export function resetJobSelectorStatus() {
  // A user may switch tabs while the background save is still running. Keep
  // the optimistic state intact if they return before that request settles.
  if (actionBusy) return;
  statusRevision += 1;
  activeEntries = [];
  statusLoaded = false;
  statusPromise = null;
  lookupResult = null;
  actionBusy = false;
}

function activeStartedLabel(entry) {
  if (!entry || !entry.startedAt) return '';
  const date = new Date(entry.startedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function setBusy(container, busy) {
  actionBusy = busy;
  container.setAttribute('aria-busy', String(busy));
  container.querySelectorAll('button, input').forEach(control => {
    if (control.classList.contains('job-selector-note-edit') || control.classList.contains('job-selector-stop-entry')) return;
    if (busy) {
      control.dataset.disabledBeforeBusy = String(control.disabled);
      control.disabled = true;
    } else {
      control.disabled = control.dataset.disabledBeforeBusy === 'true';
      delete control.dataset.disabledBeforeBusy;
    }
  });
}

function showHint(container, message, isError = false) {
  const hint = container.querySelector('.job-selector-hint');
  if (!hint) return;
  hint.textContent = message;
  hint.classList.toggle('is-error', isError);
}

function isJobSelectorMounted(container) {
  return !!container.querySelector('.job-selector-shell');
}

function beginJobs(container, jobs, selections) {
  // Compatibility note: const previousEntry = activeEntry, activeEntry = optimisticEntry,
  // and activeEntry = previousEntry were the former single-job rollback state.
  // were the former single-job rollback state.
  // Legacy signature: startJobTime(jobNum, source, jobName, costingButtonId)
  const optimisticEntries = selections.map(({ jobNum, source, jobName }) => ({ entryId: '', jobNum, jobName, source, startedAt: new Date().toISOString(), pending: true }));
  statusRevision += 1;
  activeEntries = activeEntries.concat(optimisticEntries);
  statusLoaded = true;
  lookupResult = null;
  if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
  startJobTime('', '', '', '', selections)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not start job');
      const serverEntries = result.activeEntries || (result.active ? [result.active] : []);
      const startedKeys = new Set(selections.map(item => `${item.jobNum}|${item.jobName}`));
      activeEntries = activeEntries.filter(entry => !entry.pending || !startedKeys.has(`${entry.jobNum}|${entry.jobName}`)).concat(serverEntries);
      statusLoaded = true;
      lookupResult = null;
      const workLabel = selections.map(item => item.jobNum || item.jobName).join(', ');
      showToast(result.alreadyActive ? `Already working on ${workLabel}` : `Started ${workLabel}`);
      if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
    })
    .catch(err => {
      const failedKeys = new Set(selections.map(item => `${item.jobNum}|${item.jobName}`));
      activeEntries = activeEntries.filter(entry => !entry.pending || !failedKeys.has(`${entry.jobNum}|${entry.jobName}`));
      if (isJobSelectorMounted(container)) {
        paintJobSelector(container, jobs);
        showHint(container, err.message || 'Could not start job — try again', true);
      }
      showToast('Start time was not saved — try again', 'error');
    });
}

function endWork(container, jobs, entryId) {
  if (actionBusy || !activeEntries.length) return;
  const previousEntries = activeEntries;
  statusRevision += 1;
  activeEntries = entryId ? activeEntries.filter(entry => entry.entryId !== entryId) : [];
  statusLoaded = true;
  actionBusy = true;
  if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
  stopJobTime(entryId)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not stop work');
      activeEntries = entryId ? activeEntries.filter(entry => entry.entryId !== entryId) : [];
      statusLoaded = true;
      actionBusy = false;
      showToast('Work timer stopped');
      if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
    })
    .catch(err => {
      activeEntries = previousEntries;
      actionBusy = false;
      if (isJobSelectorMounted(container)) {
        paintJobSelector(container, jobs);
        showHint(container, err.message || 'Could not stop work — try again', true);
      }
      showToast('Stop time was not saved — try again', 'error');
    });
}

function runLookup(container, jobs) {
  if (actionBusy) return;
  const input = container.querySelector('#job-selector-other-number');
  const jobNum = String(input && input.value || '').trim();
  if (!/^\d{5,6}$/.test(jobNum)) {
    showHint(container, 'Enter a five- or six-digit job number', true);
    if (input) input.focus();
    return;
  }

  setBusy(container, true);
  showHint(container, 'Looking up job in Squarecoil…');
  lookupSquarecoilJob(jobNum)
    .then(result => {
      if (!result.success || !result.found) throw new Error(result.error || 'Squarecoil job was not found');
      lookupResult = result.job;
      actionBusy = false;
      if (isJobSelectorMounted(container)) {
        paintJobSelector(container, jobs);
        container.querySelector('.job-selector-other-confirm button')?.focus();
      }
    })
    .catch(err => {
      actionBusy = false;
      if (isJobSelectorMounted(container)) {
        setBusy(container, false);
        showHint(container, err.message || 'Could not look up that job', true);
      }
    });
}

function startOtherActivity(container, jobs) {
  const input = container.querySelector('#job-selector-other-activity');
  const jobName = String(input?.value || '').trim();
  if (!jobName) { showHint(container, 'Enter an Other activity', true); input?.focus(); return; }
  beginJobs(container, jobs, [{ jobNum: '', source: 'other_activity', jobName }]);
}

function editEntryNote(container, jobs, entryId) {
  const entry = activeEntries.find(item => item.entryId === entryId);
  if (!entry) return;
  const note = window.prompt('Notes for this job', entry.notes || '');
  if (note === null) return;
  activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, notes: note, notesPending: true } : item);
  paintJobSelector(container, jobs);
  saveJobTimeNote(entryId, note).then(result => {
    if (!result.success) throw new Error(result.error || 'Could not save note');
    activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, notes: result.notes || note, notesPending: false } : item);
    paintJobSelector(container, jobs);
  }).catch(err => {
    activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, notesPending: false } : item);
    paintJobSelector(container, jobs);
    showHint(container, err.message || 'Could not save note', true);
  });
}

function bindJobSelector(container, jobs) {
  const selected = new Map();
  container.querySelectorAll('.job-selector-job').forEach(button => {
    button.addEventListener('click', () => {
      beginJobs(container, jobs, [{ jobNum: button.dataset.jobNum, source: 'assigned', jobName: button.dataset.jobName }]);
    });
  });
  container.querySelectorAll('.job-selector-note-edit').forEach(button => button.addEventListener('click', () => editEntryNote(container, jobs, button.dataset.entryId)));
  container.querySelectorAll('.job-selector-stop-entry').forEach(button => {
    button.addEventListener('click', () => endWork(container, jobs, button.dataset.entryId));
  });
  container.querySelector('.job-selector-lookup')?.addEventListener('click', () => runLookup(container, jobs));
  container.querySelector('#job-selector-other-number')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') runLookup(container, jobs);
  });
  container.querySelector('.job-selector-other-confirm button')?.addEventListener('click', () => {
    beginJobs(container, jobs, [{ jobNum: lookupResult.jobNum, source: 'other', jobName: lookupResult.name }]);
  });
  container.querySelector('.job-selector-other-activity-start')?.addEventListener('click', () => startOtherActivity(container, jobs));
}

function paintJobSelector(container, jobs) {
  const department = currentDepartment();
  const selectable = selectableJobSelectorJobs(jobs, department);
  const currentHtml = activeEntries.length
    ? `<section class="job-selector-current" aria-label="Currently working on">
        <div><span>Currently working on</span>${activeEntries.map(entry => `<div class="job-selector-active-entry"><div class="job-selector-active-identity"><small class="job-selector-active-job-number">${escapeHtml(entry.jobNum || 'Other activity')}</small><strong class="job-selector-active-job-name">${escapeHtml(entry.jobName)}</strong>${entry.notes ? `<small class="job-selector-active-note-preview">${escapeHtml(entry.notes)}${entry.notesPending ? ' · Saving…' : ''}</small>` : ''}</div><button class="job-selector-note-edit" type="button" aria-label="Edit notes for ${escapeAttr(entry.jobName)}" data-entry-id="${escapeAttr(entry.entryId)}">✎</button><button class="job-selector-stop-entry" type="button" data-entry-id="${escapeAttr(entry.entryId)}"${entry.pending ? ' disabled' : ''}>Stop</button></div>`).join('')}</div>
      </section>`
    : `<section class="job-selector-current is-idle" aria-label="Current job">
        <div><span>Currently working on</span><strong>${statusLoaded ? 'No active job' : 'Checking current job…'}</strong></div>
        <button class="job-selector-stop" type="button" disabled>Stop Work</button>
      </section>`;

  const jobsHtml = selectable.length
    ? selectable.map(job => {
      const isActive = activeEntries.some(entry => String(entry.jobNum) === String(job.jobNum));
      const taskLabel = `${job.openTaskCount} open task${job.openTaskCount === 1 ? '' : 's'}`;
      return `<button class="job-selector-job${isActive ? ' is-active' : ''}" type="button" data-job-num="${escapeAttr(job.jobNum)}" data-job-name="${escapeAttr(job.title)}">
        <span class="job-selector-job-number">${escapeHtml(job.jobNum)}</span>
        <span class="job-selector-job-name">${escapeHtml(job.title)}</span>
        <span class="job-selector-job-tasks">${escapeHtml(isActive ? 'Active now' : taskLabel)}</span>
      </button>`;
    }).join('')
    : `<div class="job-selector-empty">There are no assigned jobs with open ${escapeHtml(department)} tasks.</div>`;

  const lookupHtml = lookupResult
    ? `<div class="job-selector-other-confirm">
        <div><span>Squarecoil job found</span><strong>${escapeHtml(lookupResult.jobNum)} — ${escapeHtml(lookupResult.name)}</strong></div>
        <button type="button">Start this job</button>
      </div>`
    : '';

  container.innerHTML = `<div class="job-selector-shell">
    <header class="job-selector-heading">
      <span class="job-selector-eyebrow">Job costing</span>
      <h1>What job are you beginning work on?</h1>
      <p>Click a job to start logging time. You can log multiple jobs at the same time.</p>
    </header>
    ${currentHtml}
    <section class="job-selector-section" aria-labelledby="job-selector-assigned-title">
      <div class="job-selector-section-heading">
        <h2 id="job-selector-assigned-title">Assigned jobs</h2>
        <span>${escapeHtml(department)}</span>
      </div>
      <div class="job-selector-grid">${jobsHtml}</div>
    </section>
    <section class="job-selector-section job-selector-other" aria-labelledby="job-selector-other-title">
      <div class="job-selector-section-heading">
        <div><h2 id="job-selector-other-title">Other Job Numbers/Activities</h2><p>Look up a Squarecoil job or enter a non-job activity.</p></div>
      </div>
      <div class="job-selector-other-controls">
        <label for="job-selector-other-number">Job number</label>
        <input id="job-selector-other-number" type="text" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="Enter 5 or 6 digits" />
        <button class="job-selector-lookup" type="button">Look up job</button>
      </div>
      ${lookupHtml}
      <div class="job-selector-other-activity-controls"><label for="job-selector-other-activity">Other activity</label><input id="job-selector-other-activity" type="text" maxlength="300" autocomplete="off" placeholder="Type an activity" /><button class="job-selector-other-activity-start" type="button">Start activity</button></div>
    </section>
    <div class="job-selector-hint" role="status" aria-live="polite"></div>
  </div>`;
  bindJobSelector(container, jobs);
  if (actionBusy) setBusy(container, true);
  else container.setAttribute('aria-busy', 'false');
}

export function renderJobSelector(container, _refDate, jobs) {
  if (actionBusy && isJobSelectorMounted(container)) return;
  paintJobSelector(container, jobs);
  if (statusLoaded || statusPromise) return;
  const requestRevision = statusRevision;
  const request = fetchJobTimeStatus()
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not load current job');
      if (requestRevision !== statusRevision) return;
      activeEntries = result.activeEntries || (result.active ? [result.active] : []);
      statusLoaded = true;
      if (container.querySelector('.job-selector-shell')) paintJobSelector(container, jobs);
    })
    .catch(err => {
      if (requestRevision !== statusRevision) return;
      statusLoaded = true;
      if (container.querySelector('.job-selector-shell')) {
        paintJobSelector(container, jobs);
        showHint(container, err.message || 'Could not load current job', true);
      }
    });
  statusPromise = request;
  request.finally(() => {
    // A navigation can start a newer status request before this one settles.
    if (statusPromise === request) statusPromise = null;
  });
}

export function jobSelectorRangeLabel() {
  return 'Job Selector';
}
