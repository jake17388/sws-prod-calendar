import { toggleComplete, updateNotes, updateChecklist } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { progressBarHtml } from './progressBar.js';

let notesSaveTimer = null;

function computeProgress(checklist) {
  return checklist.length ? Math.round((checklist.filter(i => i.done).length / checklist.length) * 100) : null;
}

function saveChecklist(jobKey, checklist) {
  const progressPct = computeProgress(checklist);
  patchJob(jobKey, { checklist, progressPct });
  updateChecklist(jobKey, checklist).catch(() => {});
  document.querySelector('.job-detail-panel .progress-slot').innerHTML = progressBarHtml(progressPct);
}

function renderChecklist(job) {
  const list = document.getElementById('checklist-items');
  list.innerHTML = '';
  job.checklist.forEach(item => {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`;
    row.innerHTML = `
      <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done"></button>
      <input type="text" value="${item.text.replace(/"/g, '&quot;')}" />
      <button class="checklist-remove" aria-label="Remove item">&times;</button>
    `;
    row.querySelector('.checklist-check').addEventListener('click', () => {
      const next = job.checklist.map(i => (i.id === item.id ? { ...i, done: !i.done } : i));
      job.checklist = next;
      saveChecklist(job.jobKey, next);
      renderChecklist(job);
    });
    row.querySelector('input').addEventListener('change', e => {
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

  document.getElementById('job-detail-title').textContent = `${job.jobNum ? '#' + job.jobNum + ' — ' : ''}${job.title}`;
  document.getElementById('job-detail-meta').textContent =
    `${job.crew && job.crew.length ? job.crew.join('/') : 'Unassigned'} · starts ${job.startDate}${job.multiDay ? ' – ' + job.endDate : ''} · due ${job.dueDate}`;

  const completeBtn = document.getElementById('job-detail-complete');
  completeBtn.checked = job.completed;
  completeBtn.onchange = () => {
    const nextCompleted = completeBtn.checked;
    patchJob(job.jobKey, { completed: nextCompleted });
    toggleComplete(job.jobKey, nextCompleted).catch(() => {
      completeBtn.checked = !nextCompleted;
      patchJob(job.jobKey, { completed: !nextCompleted });
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
