import { toggleComplete, updateDueDate, fetchProofFile, uploadAdditionalFile, fetchAdditionalFile, deleteAdditionalFile } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { fmtMD, abbreviateName, formatTimestamp } from '../dates.js';
import { canEditDueDates, canMarkJobComplete, canAssignDepartments, canUploadAdditionalFiles, currentDepartment, isAdmin } from '../auth.js';
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
let viewerObjectUrl = null;
let activeJobKey = null;
const MAX_ADDITIONAL_FILE_BYTES = 8 * 1024 * 1024;

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

function prepareFileViewer(job, title) {
  if (viewerObjectUrl) {
    URL.revokeObjectURL(viewerObjectUrl);
    viewerObjectUrl = null;
  }
  document.getElementById('proof-viewer-title').textContent = `${job.jobNum ? job.jobNum + ' — ' : ''}${title}`;
  const pages = document.getElementById('proof-viewer-pages');
  pages.innerHTML = '';
  const loading = document.getElementById('proof-viewer-loading');
  loading.hidden = false;
  loading.textContent = 'Loading…';
  document.getElementById('proof-viewer-overlay').classList.add('open');
  setViewportZoomable(true);

  return { pages, loading, token: ++viewerRequestToken };
}

function openProofViewer(job, bytes) {
  const { pages, loading, token } = prepareFileViewer(job, job.title);

  renderPdfPages(pages, bytes, () => token !== viewerRequestToken)
    .then(() => { if (token === viewerRequestToken) loading.hidden = true; })
    .catch(() => { if (token === viewerRequestToken) loading.textContent = 'Failed to load PDF'; });
}

function addDownloadFallback(pages, url, name, message = 'This file type cannot be previewed in the browser.') {
  const fallback = document.createElement('div');
  fallback.className = 'file-viewer-fallback';
  const text = document.createElement('p');
  text.textContent = message;
  const download = document.createElement('a');
  download.className = 'settings-action primary';
  download.href = url;
  download.download = name;
  download.textContent = 'Download File';
  fallback.append(text, download);
  pages.appendChild(fallback);
}

function openAdditionalFileViewer(job, file, response, bytes) {
  const name = response.name || file.name || 'Additional File';
  const mimeType = response.mimeType || file.mimeType || 'application/octet-stream';
  const { pages, loading, token } = prepareFileViewer(job, name);

  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    renderPdfPages(pages, bytes, () => token !== viewerRequestToken)
      .then(() => { if (token === viewerRequestToken) loading.hidden = true; })
      .catch(() => { if (token === viewerRequestToken) loading.textContent = 'Failed to load PDF'; });
    return;
  }

  viewerObjectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const url = viewerObjectUrl;

  if (mimeType.startsWith('image/')) {
    const image = document.createElement('img');
    image.className = 'file-viewer-image';
    image.alt = name;
    image.onload = () => { if (token === viewerRequestToken) loading.hidden = true; };
    image.onerror = () => {
      if (token !== viewerRequestToken) return;
      loading.hidden = true;
      image.remove();
      addDownloadFallback(pages, url, name, 'This image could not be displayed.');
    };
    image.src = url;
    pages.appendChild(image);
    return;
  }

  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    const media = document.createElement(mimeType.startsWith('video/') ? 'video' : 'audio');
    media.className = 'file-viewer-media';
    media.controls = true;
    media.playsInline = true;
    media.src = url;
    media.onloadedmetadata = () => { if (token === viewerRequestToken) loading.hidden = true; };
    media.onerror = () => {
      if (token !== viewerRequestToken) return;
      loading.hidden = true;
      media.remove();
      addDownloadFallback(pages, url, name, 'This media file could not be played.');
    };
    pages.appendChild(media);
    return;
  }

  if (mimeType.startsWith('text/') || /\.(txt|csv|json|log|md)$/i.test(name)) {
    const text = document.createElement('pre');
    text.className = 'file-viewer-text';
    text.textContent = new TextDecoder().decode(bytes);
    pages.appendChild(text);
    loading.hidden = true;
    return;
  }

  loading.hidden = true;
  addDownloadFallback(pages, url, name);
}

export function closeProofViewer() {
  viewerRequestToken++; // stop any in-flight page rendering
  document.getElementById('proof-viewer-overlay').classList.remove('open');
  document.getElementById('proof-viewer-pages').innerHTML = '';
  if (viewerObjectUrl) {
    URL.revokeObjectURL(viewerObjectUrl);
    viewerObjectUrl = null;
  }
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
  empty.textContent = 'Loading production file…';

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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function viewAdditionalFile(job, file, button) {
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Loading…';
  try {
    const res = await fetchAdditionalFile(job.jobKey, file.id);
    if (!res || !res.available || !res.base64) throw new Error(res && (res.message || res.error));
    const bytes = base64ToBytes(res.base64);
    openAdditionalFileViewer(job, file, res, bytes);
  } catch (err) {
    showToast('Could not open file — try again', 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderAdditionalFiles(job) {
  const list = document.getElementById('job-detail-additional-list');
  const dropzone = document.getElementById('job-detail-additional-dropzone');
  const input = document.getElementById('job-detail-additional-input');
  const hint = document.getElementById('job-detail-additional-hint');
  const files = Array.isArray(job.additionalFiles) ? job.additionalFiles : [];

  list.innerHTML = '';
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'additional-files-empty';
    empty.textContent = 'No additional files yet.';
    list.appendChild(empty);
  }

  files.forEach(file => {
    const row = document.createElement('div');
    row.className = 'additional-file-row';

    const details = document.createElement('div');
    details.className = 'additional-file-details';
    const name = document.createElement('div');
    name.className = 'additional-file-name';
    name.textContent = file.name;
    const meta = document.createElement('div');
    meta.className = 'additional-file-meta';
    meta.textContent = `${file.addedBy || 'Unknown'} · ${formatTimestamp(file.addedAt)} · ${formatFileSize(file.size || 0)}`;
    details.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'additional-file-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'additional-file-action';
    view.textContent = 'View File';
    view.onclick = () => viewAdditionalFile(job, file, view);
    actions.appendChild(view);

    if (isAdmin()) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'additional-file-action danger';
      remove.textContent = 'Delete';
      remove.onclick = async () => {
        if (!confirm(`Delete ${file.name}?`)) return;
        remove.disabled = true;
        try {
          const res = await deleteAdditionalFile(job.jobKey, file.id);
          if (!res.success) throw new Error(res.error || 'failed');
          job.additionalFiles = res.additionalFiles || [];
          patchJob(job.jobKey, { additionalFiles: job.additionalFiles, updatedAt: res.updatedAt });
          if (activeJobKey === job.jobKey) renderAdditionalFiles(job);
          showToast('File deleted');
        } catch (err) {
          remove.disabled = false;
          showToast('Could not delete file — try again', 'error');
        }
      };
      actions.appendChild(remove);
    }

    row.append(details, actions);
    list.appendChild(row);
  });

  const canUpload = canUploadAdditionalFiles();
  dropzone.hidden = !canUpload;
  hint.textContent = '';
  if (!canUpload) return;

  const acceptFiles = fileList => uploadFiles(job, Array.from(fileList || []));
  dropzone.onclick = event => { if (event.target !== input) input.click(); };
  dropzone.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  };
  input.onchange = () => {
    acceptFiles(input.files);
    input.value = '';
  };
  dropzone.ondragover = event => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  };
  dropzone.ondragleave = () => dropzone.classList.remove('is-dragging');
  dropzone.ondrop = event => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    acceptFiles(event.dataTransfer.files);
  };
}

async function uploadFiles(job, files) {
  if (!files.length) return;
  const hint = document.getElementById('job-detail-additional-hint');
  let failures = 0;

  for (const file of files) {
    if (!file.size || file.size > MAX_ADDITIONAL_FILE_BYTES) {
      failures++;
      showToast(`${file.name} must be 8 MB or smaller`, 'error');
      continue;
    }
    hint.textContent = `Uploading ${file.name}…`;
    try {
      const base64 = await fileToBase64(file);
      const res = await uploadAdditionalFile(job.jobKey, file, base64);
      if (!res.success) throw new Error(res.error || 'failed');
      job.additionalFiles = res.additionalFiles || [];
      job.updatedAt = res.updatedAt || job.updatedAt;
      patchJob(job.jobKey, { additionalFiles: job.additionalFiles, updatedAt: job.updatedAt });
      if (activeJobKey === job.jobKey) renderAdditionalFiles(job);
    } catch (err) {
      failures++;
      showToast(`Could not upload ${file.name}`, 'error');
    }
  }

  if (activeJobKey === job.jobKey) {
    hint.textContent = failures ? `${failures} file${failures === 1 ? '' : 's'} could not be uploaded.` : 'Upload complete.';
  }
  if (!failures) showToast(files.length === 1 ? 'File added' : 'Files added');
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
  activeJobKey = job.jobKey;

  document.getElementById('job-detail-title').textContent = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title}`;
  updateMetaText(job);
  renderDueDateEditor(job);
  renderDepartmentSection(job);
  renderProofSection(job);
  renderAdditionalFiles(job);

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
  activeJobKey = null;
  currentProofBytes = null;
  closeProofViewer();
}
