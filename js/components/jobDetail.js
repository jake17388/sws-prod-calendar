import { toggleComplete, updateDueDate, fetchProofFile } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { fmtMD, abbreviateName, formatTimestamp } from '../dates.js';
import { canEditDueDates, canMarkJobComplete, canAssignDepartments, currentDepartment } from '../auth.js';
import { JOB_DEPARTMENTS } from '../config.js';
import { renderDepartmentEditor, renderOwnDepartmentTasks, renderDepartmentsReadOnly } from './departmentAssign.js';
import { renderNotes } from './notes.js';
import { showToast } from '../toast.js';
import { beginRequest, isLatestRequest } from '../requestSequence.js';
import { setHeaderDimmed } from '../headerDim.js';
import { renderPdfPages } from '../pdfViewer.js';

let currentProofBytes = null;
let proofRequestToken = 0;
let viewerRequestToken = 0;

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// The rest of the app disables pinch-zoom (user-scalable=no) so it feels
// like a native app rather than a webpage — but that's exactly what you
// need to read fine print on a proof, so it's switched on only while the
// full-screen viewer is open and restored the moment it closes.
const DEFAULT_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover';
const ZOOMABLE_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';
function setViewportZoomable(zoomable) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', zoomable ? ZOOMABLE_VIEWPORT_CONTENT : DEFAULT_VIEWPORT_CONTENT);
}

function openProofViewer(job, bytes) {
  document.getElementById('proof-viewer-title').textContent = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title}`;
  const pages = document.getElementById('proof-viewer-pages');
  pages.innerHTML = '';
  const loading = document.getElementById('proof-viewer-loading');
  loading.hidden = false;
  loading.textContent = 'Loading…';
  document.getElementById('proof-viewer-overlay').classList.add('open');
  setViewportZoomable(true);

  const token = ++viewerRequestToken;
  renderPdfPages(pages, bytes, () => token !== viewerRequestToken)
    .then(() => { if (token === viewerRequestToken) loading.hidden = true; })
    .catch(() => { if (token === viewerRequestToken) loading.textContent = 'Failed to load PDF'; });
}

export function closeProofViewer() {
  viewerRequestToken++; // stop any in-flight page rendering
  document.getElementById('proof-viewer-overlay').classList.remove('open');
  document.getElementById('proof-viewer-pages').innerHTML = '';
  setViewportZoomable(false);
}

// Fetched live on open rather than kept with the job list — see
// getDropboxProofFile in Code.js for why. jobKey is a job's job number, so
// a job with no Dropbox folder match (or no PDF in its Proofs folder) just
// reports { available: false } and this shows "No File Available". The PDF
// itself only renders full-screen, on demand, when "View Production File"
// is tapped — not inline in the (fairly small) job detail panel.
function renderProofSection(job) {
  const empty = document.getElementById('job-detail-proof-empty');
  const openBtn = document.getElementById('job-detail-proof-open');

  currentProofBytes = null;
  openBtn.hidden = true;
  empty.hidden = false;
  empty.textContent = 'Loading proof…';

  const token = ++proofRequestToken;
  fetchProofFile(job.jobNum)
    .then(res => {
      if (token !== proofRequestToken) return; // a newer job was opened before this resolved
      if (!res || !res.available) {
        empty.textContent = 'No File Available';
        return;
      }
      currentProofBytes = base64ToBytes(res.base64);
      empty.hidden = true;
      openBtn.hidden = false;
      openBtn.onclick = () => openProofViewer(job, currentProofBytes);
    })
    .catch(() => {
      if (token !== proofRequestToken) return;
      empty.textContent = 'No File Available';
    });
}

function renderCompletedInfo(job) {
  document.getElementById('completed-info').textContent =
    job.completed && job.completedBy ? `Completed by: ${abbreviateName(job.completedBy)} on ${formatTimestamp(job.completedAt)}` : '';
}

function updateMetaText(job) {
  document.getElementById('job-detail-meta').textContent =
    `${job.crew && job.crew.length ? job.crew.join('/') : 'Unassigned'} · starts ${fmtMD(job.startDate)}${job.multiDay ? ' – ' + fmtMD(job.endDate) : ''} · due ${fmtMD(job.dueDate)}`;
}

function renderDueDateEditor(job) {
  const wrap = document.getElementById('due-date-editor');
  wrap.hidden = !canEditDueDates();
  if (!canEditDueDates()) return;

  const editBtn = document.getElementById('due-date-edit-btn');
  const form = document.getElementById('due-date-edit-form');
  const input = document.getElementById('due-date-input');
  const hint = document.getElementById('due-date-edit-hint');

  form.hidden = true;
  editBtn.hidden = false;
  hint.textContent = '';

  editBtn.onclick = () => {
    input.value = job.dueDate;
    form.hidden = false;
    editBtn.hidden = true;
  };
  document.getElementById('due-date-cancel-btn').onclick = () => {
    form.hidden = true;
    editBtn.hidden = false;
  };

  // Must return the promise — the callers below chain .then/.catch onto it for
  // the toast and the "failed to save" hint. Without the return this threw a
  // TypeError on every save, so the override landed but the form never closed
  // and errors were silently unreachable.
  const applyOverride = dueDate => {
    return updateDueDate(job.jobKey, dueDate).then(res => {
      if (!res.success) throw new Error(res.error || 'failed');
      job.dueOverride = res.dueOverride;
      job.dueDate = res.dueOverride || job.autoDueDate;
      patchJob(job.jobKey, { dueDate: job.dueDate, dueOverride: job.dueOverride });
      updateMetaText(job);
      form.hidden = true;
      editBtn.hidden = false;
    });
  };

  document.getElementById('due-date-save-btn').onclick = () => {
    if (!input.value) { hint.textContent = 'Pick a date first'; return; }
    hint.textContent = 'Saving…';
    applyOverride(input.value)
      .then(() => showToast('Due date updated'))
      .catch(() => { hint.textContent = 'Failed to save — try again'; showToast('Failed to save due date', 'error'); });
  };
  document.getElementById('due-date-reset-btn').onclick = () => {
    hint.textContent = 'Resetting…';
    applyOverride('')
      .then(() => showToast('Due date reset to automatic'))
      .catch(() => { hint.textContent = 'Failed to reset — try again'; showToast('Failed to reset due date', 'error'); });
  };
}

// Departments a job needs, shown/editable differently per role: Admin/
// Manager get the full assign-and-edit UI (whether or not the job has any
// departments yet, and whether or not they're marked current); a
// production-department account sees its own tasks and can toggle them done
// only while its department is actually *current* on this job (matches the
// calendar filter — if it's not their turn, they wouldn't have reached this
// job in the first place); Viewers get a read-only breakdown of everything
// assigned, with current departments marked. Hidden entirely when there's
// nothing relevant for the current role to see.
function renderDepartmentSection(job) {
  const wrap = document.getElementById('job-detail-departments');
  const list = document.getElementById('job-detail-dept-list');
  if (!job.departments) job.departments = [];
  if (!job.departmentChecklists) job.departmentChecklists = {};
  if (!job.currentDepartments) job.currentDepartments = [];

  if (canAssignDepartments()) {
    wrap.hidden = false;
    renderDepartmentEditor(list, job);
    return;
  }

  const dept = currentDepartment();
  if (JOB_DEPARTMENTS.indexOf(dept) !== -1) {
    // A department can work its own checklist for as long as it's assigned
    // to the job — not just while it's "current" (see getProductionJobs in
    // Code.js, which now keeps a job visible to a department indefinitely).
    if (job.departments.indexOf(dept) === -1) { wrap.hidden = true; return; }
    wrap.hidden = false;
    renderOwnDepartmentTasks(list, job, dept);
    return;
  }

  if (job.departments.length) {
    wrap.hidden = false;
    renderDepartmentsReadOnly(list, job);
  } else {
    wrap.hidden = true;
  }
}

/** @param {string} jobKey */
export function openJobDetail(jobKey) {
  const job = findJob(jobKey);
  if (!job) return;

  document.getElementById('job-detail-title').textContent = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title}`;
  updateMetaText(job);
  renderDueDateEditor(job);
  renderDepartmentSection(job);
  renderProofSection(job);

  const canComplete = canMarkJobComplete();

  document.getElementById('job-detail-complete-row').hidden = !canComplete;
  const completeBtn = document.getElementById('job-detail-complete');
  completeBtn.checked = job.completed;
  completeBtn.disabled = !canComplete;
  renderCompletedInfo(job);
  const completeRequestKey = `job-complete:${job.jobKey}`;
  completeBtn.onchange = canComplete ? () => {
    const nextCompleted = completeBtn.checked;
    const prevCompleted = job.completed;
    // Same out-of-order-response guard as jobCard.js — rapid toggling here
    // fires overlapping requests, and only the latest one's response should
    // ever be allowed to update the checkbox.
    const token = beginRequest(completeRequestKey);
    job.completed = nextCompleted;
    patchJob(job.jobKey, { completed: nextCompleted });
    renderDepartmentSection(job); // lock/unlock department editing immediately, without reopening the panel
    toggleComplete(job.jobKey, nextCompleted)
      .then(res => {
        if (!isLatestRequest(completeRequestKey, token)) return;
        if (!res.success) throw new Error(res.error || 'failed');
        const patch = { completed: res.completed, completedAt: res.completedAt, completedBy: res.completedBy };
        Object.assign(job, patch);
        patchJob(job.jobKey, patch);
        renderCompletedInfo(job);
      })
      .catch(() => {
        if (!isLatestRequest(completeRequestKey, token)) return;
        completeBtn.checked = prevCompleted;
        job.completed = prevCompleted;
        patchJob(job.jobKey, { completed: prevCompleted });
        renderCompletedInfo(job);
        renderDepartmentSection(job);
        showToast('Failed to update job — check your connection', 'error');
      });
  } : null;

  renderNotes(document.getElementById('job-detail-notes'), job, { canWrite: true });

  document.getElementById('job-detail-overlay').classList.add('open');
  setHeaderDimmed(true);
}

export function closeJobDetail() {
  document.getElementById('job-detail-overlay').classList.remove('open');
  setHeaderDimmed(false);
  proofRequestToken++; // invalidate any in-flight proof fetch
  currentProofBytes = null;
  closeProofViewer();
}
