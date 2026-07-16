import { toggleComplete, updateNotes, updateDueDate } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { fmtMD, abbreviateName, formatTimestamp } from '../dates.js';
import { canEditDueDates, canEditJobs, canMarkJobComplete, canAssignDepartments, currentDepartment } from '../auth.js';
import { JOB_DEPARTMENTS } from '../config.js';
import { renderDepartmentEditor, renderOwnDepartmentTasks, renderDepartmentsReadOnly } from './departmentAssign.js';
import { showToast } from '../toast.js';
import { beginRequest, isLatestRequest } from '../requestSequence.js';

let notesSaveTimer = null;

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

  const applyOverride = dueDate => {
    updateDueDate(job.jobKey, dueDate).then(res => {
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
  if (!job.departmentNotes) job.departmentNotes = {};

  if (canAssignDepartments()) {
    wrap.hidden = false;
    renderDepartmentEditor(list, job);
    return;
  }

  const dept = currentDepartment();
  if (JOB_DEPARTMENTS.indexOf(dept) !== -1) {
    if (job.currentDepartments.indexOf(dept) === -1) { wrap.hidden = true; return; }
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

  const canEdit = canEditJobs();
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
      });
  } : null;

  const notesEl = document.getElementById('job-detail-notes');
  const notesHint = document.getElementById('notes-save-hint');
  notesEl.value = job.notes || '';
  notesEl.readOnly = !canEdit;
  notesEl.oninput = canEdit ? () => {
    notesHint.textContent = 'Saving…';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      const expectedUpdatedAt = job.updatedAt;
      patchJob(job.jobKey, { notes: notesEl.value });
      updateNotes(job.jobKey, notesEl.value, expectedUpdatedAt)
        .then(res => {
          if (res.error === 'conflict') {
            job.notes = res.notes;
            job.updatedAt = res.updatedAt;
            patchJob(job.jobKey, { notes: res.notes, updatedAt: res.updatedAt });
            notesEl.value = res.notes;
            notesHint.textContent = 'Someone else edited this — showing their version, please redo your change';
            showToast('Someone else edited these notes first', 'error');
            return;
          }
          if (!res.success) { notesHint.textContent = 'Failed to save — try again'; showToast('Failed to save notes', 'error'); return; }
          job.updatedAt = res.updatedAt;
          patchJob(job.jobKey, { updatedAt: res.updatedAt });
          notesHint.textContent = 'Saved';
          setTimeout(() => (notesHint.textContent = ''), 1500);
        })
        .catch(() => { notesHint.textContent = 'Failed to save — try again'; showToast('Failed to save notes', 'error'); });
    }, 600);
  } : null;

  document.getElementById('job-detail-overlay').classList.add('open');
}

export function closeJobDetail() {
  document.getElementById('job-detail-overlay').classList.remove('open');
}
