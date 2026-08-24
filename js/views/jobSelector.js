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

export function resetJobSelectorStatus() {
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

function beginJob(container, jobs, jobNum, source) {
  if (actionBusy) return;
  setBusy(container, true);
  showHint(container, 'Saving start time…');
  startJobTime(jobNum, source)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not start job');
      activeEntry = result.active;
      statusLoaded = true;
      lookupResult = null;
      showToast(result.alreadyActive ? `Already working on ${jobNum}` : `Started job ${jobNum}`);
      paintJobSelector(container, jobs);
    })
    .catch(err => {
      setBusy(container, false);
      showHint(container, err.message || 'Could not start job — try again', true);
    });
}

function endWork(container, jobs) {
  if (actionBusy || !activeEntry) return;
  setBusy(container, true);
  showHint(container, 'Saving stop time…');
  stopJobTime()
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not stop work');
      activeEntry = null;
      statusLoaded = true;
      showToast('Work timer stopped');
      paintJobSelector(container, jobs);
    })
    .catch(err => {
      setBusy(container, false);
      showHint(container, err.message || 'Could not stop work — try again', true);
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
      paintJobSelector(container, jobs);
      container.querySelector('.job-selector-other-confirm button')?.focus();
    })
    .catch(err => {
      setBusy(container, false);
      showHint(container, err.message || 'Could not look up that job', true);
    });
}

function bindJobSelector(container, jobs) {
  container.querySelectorAll('.job-selector-job').forEach(button => {
    button.addEventListener('click', () => beginJob(container, jobs, button.dataset.jobNum, 'assigned'));
  });
  container.querySelector('.job-selector-stop')?.addEventListener('click', () => endWork(container, jobs));
  container.querySelector('.job-selector-lookup')?.addEventListener('click', () => runLookup(container, jobs));
  container.querySelector('#job-selector-other-number')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') runLookup(container, jobs);
  });
  container.querySelector('.job-selector-other-confirm button')?.addEventListener('click', () => {
    beginJob(container, jobs, lookupResult.jobNum, 'other');
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
      return `<button class="job-selector-job${isActive ? ' is-active' : ''}" type="button" data-job-num="${escapeAttr(job.jobNum)}" ${isActive ? 'disabled' : ''}>
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
  container.setAttribute('aria-busy', 'false');
  actionBusy = false;
  bindJobSelector(container, jobs);
}

export function renderJobSelector(container, _refDate, jobs) {
  paintJobSelector(container, jobs);
  if (statusLoaded || statusPromise) return;
  statusPromise = fetchJobTimeStatus()
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not load current job');
      activeEntry = result.active || null;
      statusLoaded = true;
      if (container.querySelector('.job-selector-shell')) paintJobSelector(container, jobs);
    })
    .catch(err => {
      statusLoaded = true;
      if (container.querySelector('.job-selector-shell')) {
        paintJobSelector(container, jobs);
        showHint(container, err.message || 'Could not load current job', true);
      }
    })
    .finally(() => { statusPromise = null; });
}

export function jobSelectorRangeLabel() {
  return 'Job Selector';
}
