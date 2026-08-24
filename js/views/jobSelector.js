import { fetchJobTimeStatus, lookupSquarecoilJob, startJobTime, stopJobTime } from '../api.js';
import { currentDepartment } from '../auth.js';
import { selectableJobSelectorJobs } from '../jobSelectorModel.mjs';
import { escapeAttr, escapeHtml } from '../lib/html.js';
import { showToast } from '../toast.js';

let activeEntry = null;
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
  activeEntry = null;
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

function beginJob(container, jobs, jobNum, source, jobName) {
  if (actionBusy) return;
  const previousEntry = activeEntry;
  const optimisticEntry = {
    entryId: '', jobNum, jobName, source,
    startedAt: new Date().toISOString(), pending: true,
  };
  statusRevision += 1;
  activeEntry = optimisticEntry;
  statusLoaded = true;
  lookupResult = null;
  actionBusy = true;
  if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
  startJobTime(jobNum, source, jobName)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not start job');
      activeEntry = result.active;
      statusLoaded = true;
      lookupResult = null;
      actionBusy = false;
      showToast(result.alreadyActive ? `Already working on ${jobNum}` : `Started job ${jobNum}`);
      if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
    })
    .catch(err => {
      activeEntry = previousEntry;
      actionBusy = false;
      if (isJobSelectorMounted(container)) {
        paintJobSelector(container, jobs);
        showHint(container, err.message || 'Could not start job — try again', true);
      }
      showToast('Start time was not saved — try again', 'error');
    });
}

function endWork(container, jobs) {
  if (actionBusy || !activeEntry) return;
  const previousEntry = activeEntry;
  statusRevision += 1;
  activeEntry = null;
  statusLoaded = true;
  actionBusy = true;
  if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
  stopJobTime()
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not stop work');
      activeEntry = null;
      statusLoaded = true;
      actionBusy = false;
      showToast('Work timer stopped');
      if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
    })
    .catch(err => {
      activeEntry = previousEntry;
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

function bindJobSelector(container, jobs) {
  container.querySelectorAll('.job-selector-job').forEach(button => {
    button.addEventListener('click', () => {
      const taskLabel = button.querySelector('.job-selector-job-tasks');
      if (taskLabel) taskLabel.textContent = 'Starting…';
      beginJob(container, jobs, button.dataset.jobNum, 'assigned', button.dataset.jobName);
    });
  });
  container.querySelector('.job-selector-stop')?.addEventListener('click', () => endWork(container, jobs));
  container.querySelector('.job-selector-lookup')?.addEventListener('click', () => runLookup(container, jobs));
  container.querySelector('#job-selector-other-number')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') runLookup(container, jobs);
  });
  container.querySelector('.job-selector-other-confirm button')?.addEventListener('click', () => {
    beginJob(container, jobs, lookupResult.jobNum, 'other', lookupResult.name);
  });
}

function paintJobSelector(container, jobs) {
  const department = currentDepartment();
  const selectable = selectableJobSelectorJobs(jobs, department);
  const startedLabel = activeStartedLabel(activeEntry);
  const currentHtml = activeEntry
    ? `<section class="job-selector-current" aria-label="Current job">
        <div><span>Currently working on</span><strong>${escapeHtml(activeEntry.jobNum)} — ${escapeHtml(activeEntry.jobName)}</strong>${startedLabel ? `<small>Started at ${escapeHtml(startedLabel)}</small>` : ''}</div>
        <button class="job-selector-stop" type="button">Stop Work</button>
      </section>`
    : `<section class="job-selector-current is-idle" aria-label="Current job">
        <div><span>Currently working on</span><strong>${statusLoaded ? 'No active job' : 'Checking current job…'}</strong></div>
        <button class="job-selector-stop" type="button" disabled>Stop Work</button>
      </section>`;

  const jobsHtml = selectable.length
    ? selectable.map(job => {
      const isActive = activeEntry && String(activeEntry.jobNum) === String(job.jobNum);
      const taskLabel = `${job.openTaskCount} open task${job.openTaskCount === 1 ? '' : 's'}`;
      return `<button class="job-selector-job${isActive ? ' is-active' : ''}" type="button" data-job-num="${escapeAttr(job.jobNum)}" data-job-name="${escapeAttr(job.title)}" ${isActive ? 'disabled' : ''}>
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
      <p>Select an assigned job below. Starting another job automatically ends your current one.</p>
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
        <div><h2 id="job-selector-other-title">Other job number</h2><p>Look up a job directly in Squarecoil.</p></div>
      </div>
      <div class="job-selector-other-controls">
        <label for="job-selector-other-number">Job number</label>
        <input id="job-selector-other-number" type="text" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="Enter 5 or 6 digits" />
        <button class="job-selector-lookup" type="button">Look up job</button>
      </div>
      ${lookupHtml}
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
      activeEntry = result.active || null;
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
