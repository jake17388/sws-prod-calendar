import { toggleComplete, updateNotes, updateChecklist, updateDueDate } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { progressBarHtml } from './progressBar.js';
import { fmtMD } from '../dates.js';
import { canEditDueDates } from '../auth.js';

let notesSaveTimer = null;

// Matches the server-side calc in Code.js so the bar shown here never
// disagrees with what a refetch would compute.
function computeProgress(checklist) {
  if (!checklist.length) return null;
  const done = checklist.filter(i => i.done).length;
  return Math.round((done / checklist.length) * 100);
}

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

function saveChecklist(jobKey, checklist) {
  const progressPct = computeProgress(checklist);
  patchJob(jobKey, { checklist, progressPct });
  updateChecklist(jobKey, checklist).catch(() => {});
  document.querySelector('.job-detail-panel .progress-slot').innerHTML = progressBarHtml(progressPct);
}

function updateChecklistItem(job, itemId, patch) {
  const next = job.checklist.map(i => (i.id === itemId ? { ...i, ...patch } : i));
  job.checklist = next;
  saveChecklist(job.jobKey, next);
  renderChecklist(job);
}

function renderPlainRow(row, job, item) {
  row.innerHTML = `
    <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done"></button>
    <input type="text" value="${item.text.replace(/"/g, '&quot;')}" />
    <button class="checklist-remove" aria-label="Remove item">&times;</button>
  `;
  row.querySelector('.checklist-check').addEventListener('click', () => {
    updateChecklistItem(job, item.id, { done: !item.done });
  });
}

function renderChecklist(job) {
  const list = document.getElementById('checklist-items');
  list.innerHTML = '';
  job.checklist.forEach(item => {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
    renderPlainRow(row, job, item);

    row.querySelector('input[type="text"]').addEventListener('change', e => {
      const next = job.checklist.map(i => (i.id === item.id ? { ...i, text: e.target.value } : i));
      job.checklist = next;
      saveChecklist(job.jobKey, next);
    });
    row.querySelector('.checklist-remove').addEventListener('click', () => {
      const next = job.checklist.filter(i => i.id !== item.id);
      job.checklist = next;
      saveChecklist(job.jobKey, next);
      renderChecklist(job);
    });
    list.appendChild(row);
  });
}

/** @param {string} jobKey */
export function openJobDetail(jobKey) {
  const job = findJob(jobKey);
  if (!job) return;

  document.getElementById('job-detail-title').textContent = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title}`;
  updateMetaText(job);
  renderDueDateEditor(job);

  const completeBtn = document.getElementById('job-detail-complete');
  completeBtn.checked = job.completed;
  renderCompletedInfo(job);
  completeBtn.onchange = () => {
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
  };

  const notesEl = document.getElementById('job-detail-notes');
  const notesHint = document.getElementById('notes-save-hint');
  notesEl.value = job.notes || '';
  notesEl.oninput = () => {
    notesHint.textContent = 'Saving…';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      patchJob(job.jobKey, { notes: notesEl.value });
      updateNotes(job.jobKey, notesEl.value)
        .then(() => { notesHint.textContent = 'Saved'; setTimeout(() => (notesHint.textContent = ''), 1500); })
        .catch(() => { notesHint.textContent = 'Failed to save — try again'; });
    }, 600);
  };

  document.querySelector('.job-detail-panel .progress-slot').innerHTML = progressBarHtml(job.progressPct);
  renderChecklist(job);

  const addInput = document.getElementById('checklist-add-input');
  addInput.value = '';
  document.getElementById('checklist-add-btn').onclick = () => addChecklistItem(job, addInput);
  addInput.onkeydown = e => { if (e.key === 'Enter') addChecklistItem(job, addInput); };

  document.getElementById('job-detail-overlay').classList.add('open');
}

function addChecklistItem(job, input) {
  const text = input.value.trim();
  if (!text) return;
  const next = [...job.checklist, { id: `${Date.now()}`, text, done: false }];
  job.checklist = next;
  input.value = '';
  saveChecklist(job.jobKey, next);
  renderChecklist(job);
}

export function closeJobDetail() {
  document.getElementById('job-detail-overlay').classList.remove('open');
}
