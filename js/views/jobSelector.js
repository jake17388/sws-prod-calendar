import { fetchJobTimeStatus, lookupSquarecoilJob, pauseJobTime, resumeJobTime, saveJobTimeNote, startJobTime, stopJobTime, toggleSavedJob } from '../api.js';
import { currentDepartment } from '../auth.js';
import { selectableJobSelectorJobs } from '../jobSelectorModel.mjs';
import { createJobNoteState, jobNoteShortcut, shouldSaveJobNote } from '../jobNoteModal.mjs';
import { escapeAttr, escapeHtml } from '../lib/html.js';
import { showToast } from '../toast.js';

let activeEntries = [];
let savedJobs = [];
let statusLoaded = false;
let statusPromise = null;
let lookupResult = null;
let actionBusy = false;
let statusRevision = 0;

const noteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-14.5Z" /></svg>';
const bookmarkIcon = isSaved => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"${isSaved ? ' fill="currentColor"' : ''} /></svg>`;
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor" stroke="none" /></svg>';
const resumeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" /></svg>';

export function resetJobSelectorStatus() {
  // A user may switch tabs while the background save is still running. Keep
  // the optimistic state intact if they return before that request settles.
  if (actionBusy) return;
  statusRevision += 1;
  activeEntries = [];
  savedJobs = [];
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
    if (control.classList.contains('job-selector-note-edit') || control.classList.contains('job-selector-pause-entry') || control.classList.contains('job-selector-resume-entry') || control.classList.contains('job-selector-stop-entry')) return;
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

function entryKey(entry) {
  return `${entry.jobNum || ''}|${entry.jobName || ''}`;
}

function dedupeActiveEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function beginJobs(container, jobs, selections) {
  // Compatibility note: const previousEntry = activeEntry, activeEntry = optimisticEntry,
  // and activeEntry = previousEntry were the former single-job rollback state.
  // were the former single-job rollback state.
  // Legacy signature: startJobTime(jobNum, source, jobName, costingButtonId)
  const optimisticEntries = selections.map(({ jobNum, source, jobName }) => ({ entryId: '', jobNum, jobName, source, startedAt: new Date().toISOString(), pending: true }));
  statusRevision += 1;
  const newSelections = optimisticEntries.filter(entry => !activeEntries.some(item => entryKey(item) === entryKey(entry)));
  if (!newSelections.length) return;
  activeEntries = dedupeActiveEntries(activeEntries.concat(newSelections));
  statusLoaded = true;
  lookupResult = null;
  if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
  startJobTime('', '', '', '', selections)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not start job');
      const serverEntries = result.activeEntries || (result.active ? [result.active] : []);
      const startedKeys = new Set(selections.map(item => `${item.jobNum}|${item.jobName}`));
      activeEntries = dedupeActiveEntries(activeEntries.filter(entry => !entry.pending || !startedKeys.has(entryKey(entry))).concat(serverEntries));
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
  if (!activeEntries.length) return;
  const entry = activeEntries.find(item => !entryId || item.entryId === entryId);
  if (!entry || entry.stopPending) return;
  statusRevision += 1;
  activeEntries = entryId
    ? activeEntries.map(item => item.entryId === entryId ? { ...item, stopPending: true } : item)
    : activeEntries.map(item => ({ ...item, stopPending: true }));
  statusLoaded = true;
  if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
  stopJobTime(entryId)
    .then(result => {
      if (!result.success) throw new Error(result.error || 'Could not stop work');
      activeEntries = entryId ? activeEntries.filter(entry => entry.entryId !== entryId) : [];
      statusLoaded = true;
      showToast('Work timer stopped');
      if (isJobSelectorMounted(container)) paintJobSelector(container, jobs);
    })
    .catch(err => {
      activeEntries = entryId
        ? activeEntries.map(item => item.entryId === entryId ? { ...item, stopPending: false } : item)
        : activeEntries.map(item => ({ ...item, stopPending: false }));
      if (isJobSelectorMounted(container)) {
        paintJobSelector(container, jobs);
        showHint(container, err.message || 'Could not stop work — try again', true);
      }
      showToast('Stop time was not saved — try again', 'error');
    });
}

function pauseWork(container, jobs, entryId) {
  const entry = activeEntries.find(item => item.entryId === entryId);
  if (!entry || entry.paused || entry.pausePending) return;
  activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, pausePending: true } : item);
  paintJobSelector(container, jobs);
  pauseJobTime(entryId).then(result => {
    if (!result.success) throw new Error(result.error || 'Could not pause work');
    activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, ...result.paused, paused: true, pausePending: false } : item);
    paintJobSelector(container, jobs);
    showToast('Work timer paused');
  }).catch(err => {
    activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, pausePending: false } : item);
    paintJobSelector(container, jobs);
    showHint(container, err.message || 'Could not pause work — try again', true);
  });
}

function resumeWork(container, jobs, entryId) {
  const entry = activeEntries.find(item => item.entryId === entryId);
  if (!entry || !entry.paused || entry.resumePending) return;
  activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, resumePending: true } : item);
  paintJobSelector(container, jobs);
  resumeJobTime(entryId).then(result => {
    if (!result.success || !result.active) throw new Error(result.error || 'Could not resume work');
    activeEntries = activeEntries.map(item => item.entryId === entryId ? result.active : item);
    paintJobSelector(container, jobs);
    showToast('Work timer resumed');
  }).catch(err => {
    activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, resumePending: false } : item);
    paintJobSelector(container, jobs);
    showHint(container, err.message || 'Could not resume work — try again', true);
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

function returnNoteFocus(container, entryId) {
  container.querySelector(`.job-selector-note-edit[data-entry-id="${CSS.escape(entryId)}"]`)?.focus();
}

function editEntryNote(container, jobs, entryId, trigger) {
  const entry = activeEntries.find(item => item.entryId === entryId);
  if (!entry) return;
  const state = createJobNoteState({ entryId, jobNum: entry.jobNum, jobName: entry.jobName, note: entry.notes || '' });
  const overlay = document.createElement('div');
  overlay.className = 'job-note-modal-backdrop';
  overlay.innerHTML = `<section class="job-note-modal" role="dialog" aria-modal="true" aria-labelledby="job-note-modal-title" aria-describedby="job-note-modal-context">
    <header class="job-note-modal-header">
      <div><h2 id="job-note-modal-title">Job note</h2><p id="job-note-modal-context"><strong>${escapeHtml(entry.jobNum || 'Other activity')}</strong><span>${escapeHtml(entry.jobName)}</span></p></div>
      <button class="job-note-modal-close" type="button" aria-label="Close job note">×</button>
    </header>
    <div class="job-note-modal-body">
      <label for="job-note-modal-textarea">Note</label>
      <textarea id="job-note-modal-textarea" maxlength="1000" placeholder="Add progress, issues, materials needed, or handoff details…"></textarea>
      <div class="job-note-modal-error" role="alert" hidden></div>
    </div>
    <footer class="job-note-modal-actions">
      <button class="job-note-modal-cancel" type="button">Cancel</button>
      <button class="job-note-modal-save" type="button" disabled>Save note</button>
    </footer>
  </section>`;
  document.body.append(overlay);
  document.body.classList.add('job-note-modal-open');
  const dialog = overlay.querySelector('.job-note-modal');
  const textarea = overlay.querySelector('textarea');
  const saveButton = overlay.querySelector('.job-note-modal-save');
  const error = overlay.querySelector('.job-note-modal-error');
  textarea.value = state.draft;

  const updateSaveButton = () => { saveButton.disabled = !shouldSaveJobNote(state); };
  const close = force => {
    if (!force && !state.canCloseWithoutConfirmation() && !window.confirm('Discard your unsaved job note changes?')) return;
    overlay.remove();
    document.body.classList.remove('job-note-modal-open');
    if (trigger?.isConnected) trigger.focus();
    else returnNoteFocus(container, entryId);
  };
  const save = async () => {
    if (!shouldSaveJobNote(state)) return;
    error.hidden = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      const result = await state.save(value => saveJobTimeNote(entryId, value));
      activeEntries = activeEntries.map(item => item.entryId === entryId ? { ...item, notes: result.notes ?? state.valueToSave() } : item);
      paintJobSelector(container, jobs);
      showToast(result.notes ? 'Job note saved' : 'Job note removed');
      close(true);
    } catch (err) {
      error.textContent = `${err.message || 'Could not save note'}. Your draft is still here — try again.`;
      error.hidden = false;
      saveButton.textContent = 'Save note';
      updateSaveButton();
      textarea.focus();
    }
  };

  textarea.addEventListener('input', () => { state.setDraft(textarea.value); error.hidden = true; updateSaveButton(); });
  saveButton.addEventListener('click', save);
  overlay.querySelector('.job-note-modal-cancel').addEventListener('click', () => close(false));
  overlay.querySelector('.job-note-modal-close').addEventListener('click', () => close(false));
  dialog.addEventListener('keydown', event => {
    const shortcut = jobNoteShortcut(event);
    if (shortcut === 'save') { event.preventDefault(); save(); return; }
    if (shortcut === 'close') { event.preventDefault(); close(false); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), textarea')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); });
}

function toggleEntrySaved(container, jobs, entryId) {
  const entry = activeEntries.find(item => item.entryId === entryId);
  if (!entry || !entry.jobNum) return;
  const wasSaved = savedJobs.some(job => String(job.jobNum) === String(entry.jobNum));
  savedJobs = wasSaved ? savedJobs.filter(job => String(job.jobNum) !== String(entry.jobNum)) : savedJobs.concat({ jobNum: entry.jobNum, jobName: entry.jobName });
  paintJobSelector(container, jobs);
  toggleSavedJob(entry.jobNum, entry.jobName).then(result => {
    if (!result.success) throw new Error(result.error || 'Could not update saved job');
    savedJobs = result.savedJobs || savedJobs;
    paintJobSelector(container, jobs);
    showToast(result.saved ? 'Job saved' : 'Job removed from Saved Jobs');
  }).catch(err => {
    savedJobs = wasSaved ? savedJobs.concat({ jobNum: entry.jobNum, jobName: entry.jobName }) : savedJobs.filter(job => String(job.jobNum) !== String(entry.jobNum));
    paintJobSelector(container, jobs);
    showHint(container, err.message || 'Could not update saved job', true);
  });
}

function bindJobSelector(container, jobs) {
  const selected = new Map();
  container.querySelectorAll('.job-selector-job').forEach(button => {
    button.addEventListener('click', () => {
      beginJobs(container, jobs, [{ jobNum: button.dataset.jobNum, source: button.dataset.jobSource || 'assigned', jobName: button.dataset.jobName }]);
    });
  });
  container.querySelectorAll('.job-selector-note-edit').forEach(button => button.addEventListener('click', () => editEntryNote(container, jobs, button.dataset.entryId, button)));
  container.querySelectorAll('.job-selector-bookmark').forEach(button => button.addEventListener('click', () => toggleEntrySaved(container, jobs, button.dataset.entryId)));
  container.querySelectorAll('.job-selector-pause-entry').forEach(button => button.addEventListener('click', () => pauseWork(container, jobs, button.dataset.entryId)));
  container.querySelectorAll('.job-selector-resume-entry').forEach(button => button.addEventListener('click', () => resumeWork(container, jobs, button.dataset.entryId)));
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
        <div><span>Currently working on</span>${activeEntries.map(entry => { const isSaved = savedJobs.some(job => String(job.jobNum) === String(entry.jobNum)); return `<div class="job-selector-active-entry${entry.paused ? ' is-paused' : ''}"><div class="job-selector-active-identity"><small class="job-selector-active-job-number">${escapeHtml(entry.jobNum || 'Other activity')}</small><strong class="job-selector-active-job-name">${escapeHtml(entry.jobName)}</strong></div><button class="job-selector-note-edit${entry.notes ? ' has-note' : ''}" type="button" aria-label="${entry.notes ? 'Edit job note' : 'Add job note'}" data-entry-id="${escapeAttr(entry.entryId)}">${noteIcon}</button>${entry.jobNum ? `<button class="job-selector-bookmark${isSaved ? ' is-saved' : ''}" type="button" aria-label="${isSaved ? 'Remove' : 'Save'} ${escapeAttr(entry.jobName)} ${isSaved ? 'from' : 'to'} Saved Jobs" aria-pressed="${isSaved}" data-entry-id="${escapeAttr(entry.entryId)}">${bookmarkIcon(isSaved)}</button>` : '<span class="job-selector-bookmark-spacer"></span>'}${entry.paused ? `<button class="job-selector-resume-entry" type="button" aria-label="${entry.resumePending ? 'Resuming' : 'Resume'} ${escapeAttr(entry.jobName)}" data-entry-id="${escapeAttr(entry.entryId)}"${entry.resumePending || entry.stopPending ? ' disabled' : ''}>${resumeIcon}</button>` : `<button class="job-selector-pause-entry" type="button" aria-label="${entry.pausePending ? 'Pausing…' : 'Pause'} ${escapeAttr(entry.jobName)}" data-entry-id="${escapeAttr(entry.entryId)}"${entry.pending || entry.pausePending || entry.stopPending ? ' disabled' : ''}>${pauseIcon}</button>`}<button class="job-selector-stop-entry" type="button" data-entry-id="${escapeAttr(entry.entryId)}"${entry.pending || entry.pausePending || entry.resumePending || entry.stopPending ? ' disabled' : ''}>${entry.stopPending ? 'Stopping…' : 'Stop'}</button></div>`; }).join('')}</div>
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

  const savedJobsHtml = savedJobs.length
    ? savedJobs.map(job => { const isActive = activeEntries.some(entry => String(entry.jobNum) === String(job.jobNum)); return `<button class="job-selector-job${isActive ? ' is-active' : ''}" type="button" data-job-num="${escapeAttr(job.jobNum)}" data-job-name="${escapeAttr(job.jobName)}" data-job-source="saved"><span class="job-selector-job-number">${escapeHtml(job.jobNum)}</span><span class="job-selector-job-name">${escapeHtml(job.jobName)}</span><span class="job-selector-job-tasks">${isActive ? 'Active now' : 'Saved job'}</span></button>`; }).join('')
    : '<div class="job-selector-empty">Bookmark a job while working on it to save it here.</div>';

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
    <section class="job-selector-section" aria-labelledby="job-selector-saved-title">
      <div class="job-selector-section-heading"><h2 id="job-selector-saved-title">Saved Jobs</h2></div>
      <div class="job-selector-grid">${savedJobsHtml}</div>
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
      activeEntries = dedupeActiveEntries(result.activeEntries || (result.active ? [result.active] : []));
      savedJobs = result.savedJobs || [];
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
