import { toggleComplete, updateNotes, updateDueDate } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { fmtMD } from '../dates.js';
import { canEditDueDates, canEditJobs, canMarkJobComplete, canAssignDepartments, currentDepartment } from '../auth.js';
import { JOB_DEPARTMENTS } from '../config.js';
import { renderDepartmentEditor, renderOwnDepartmentTasks, renderDepartmentsReadOnly } from './departmentAssign.js';

let notesSaveTimer = null;

const abbreviateName = name => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}` : name;
};

const formatCompletedStamp = iso => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
};

function renderCompletedInfo(job) {
  document.getElementById('completed-info').textContent =
    job.completed && job.completedBy ? `Completed by: ${abbreviateName(job.completedBy)} on ${formatCompletedStamp(job.completedAt)}` : '';
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
    applyOverride(input.value).catch(() => { hint.textContent = 'Failed to save — try again'; });
  };
  document.getElementById('due-date-reset-btn').onclick = () => {
    hint.textContent = 'Resetting…';
    applyOverride('').catch(() => { hint.textContent = 'Failed to reset — try again'; });
  };
}

// Departments a job has been assigned to, shown/editable differently per
// role: Admin/Manager get the full assign-and-edit UI (whether or not the
// job has any departments yet); a production-department account sees only
// its own department's tasks and can toggle them done, nothing else;
// Viewers get a read-only breakdown. Hidden entirely when there's nothing
// relevant for the current role to see.
function renderDepartmentSection(job) {
  const wrap = document.getElementById('job-detail-departments');
  const list = document.getElementById('job-detail-dept-list');
  if (!job.departments) job.departments = [];
  if (!job.departmentChecklists) job.departmentChecklists = {};

  if (canAssignDepartments()) {
    wrap.hidden = false;
    renderDepartmentEditor(list, job);
    return;
  }

  const dept = currentDepartment();
  if (JOB_DEPARTMENTS.indexOf(dept) !== -1) {
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

  const canEdit = canEditJobs();
  const canComplete = canMarkJobComplete();

  document.getElementById('job-detail-complete-row').hidden = !canComplete;
  const completeBtn = document.getElementById('job-detail-complete');
  completeBtn.checked = job.completed;
  completeBtn.disabled = !canComplete;
  renderCompletedInfo(job);
  completeBtn.onchange = canComplete ? () => {
    const nextCompleted = completeBtn.checked;
    patchJob(job.jobKey, { completed: nextCompleted });
    toggleComplete(job.jobKey, nextCompleted)
      .then(res => {
        if (!res.success) throw new Error(res.error || 'failed');
        const patch = { completed: res.completed, completedAt: res.completedAt, completedBy: res.completedBy };
        patchJob(job.jobKey, patch);
        renderCompletedInfo({ ...job, ...patch });
      })
      .catch(() => {
        completeBtn.checked = !nextCompleted;
        patchJob(job.jobKey, { completed: !nextCompleted });
        renderCompletedInfo(job);
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
      patchJob(job.jobKey, { notes: notesEl.value });
      updateNotes(job.jobKey, notesEl.value)
        .then(() => { notesHint.textContent = 'Saved'; setTimeout(() => (notesHint.textContent = ''), 1500); })
        .catch(() => { notesHint.textContent = 'Failed to save — try again'; });
    }, 600);
  } : null;

  document.getElementById('job-detail-overlay').classList.add('open');
}

export function closeJobDetail() {
  document.getElementById('job-detail-overlay').classList.remove('open');
}
