import { updateJobDepartments } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { JOB_TAGS } from '../config.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Persists the job's full departments/departmentChecklists state after any
// change — mirrors how the old flat checklist saved itself on every edit.
function persist(job) {
  updateJobDepartments(job.jobKey, job.departments, job.departmentChecklists).catch(() => {});
  patchJob(job.jobKey, { departments: job.departments, departmentChecklists: job.departmentChecklists });
}

function renderDeptChecklist(container, job, dept) {
  container.innerHTML = '';
  const items = job.departmentChecklists[dept] || [];

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
    row.innerHTML = `
      <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done"></button>
      <input type="text" value="${item.text.replace(/"/g, '&quot;')}" />
      <button class="checklist-remove" aria-label="Remove item">&times;</button>
    `;
    row.querySelector('.checklist-check').addEventListener('click', () => {
      item.done = !item.done;
      persist(job);
      renderDeptChecklist(container, job, dept);
    });
    row.querySelector('input[type="text"]').addEventListener('change', e => {
      item.text = e.target.value.trim();
      persist(job);
    });
    row.querySelector('.checklist-remove').addEventListener('click', () => {
      job.departmentChecklists[dept] = items.filter(i => i.id !== item.id);
      persist(job);
      renderDeptChecklist(container, job, dept);
    });
    container.appendChild(row);
  });

  const addRow = document.createElement('div');
  addRow.className = 'checklist-add';
  addRow.innerHTML = '<input type="text" placeholder="Add item…" /><button>Add</button>';
  const addInput = addRow.querySelector('input');
  const doAdd = () => {
    const text = addInput.value.trim();
    if (!text) return;
    job.departmentChecklists[dept] = [...(job.departmentChecklists[dept] || []), { id: `${Date.now()}`, text, done: false }];
    addInput.value = '';
    persist(job);
    renderDeptChecklist(container, job, dept);
  };
  addRow.querySelector('button').addEventListener('click', doAdd);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  container.appendChild(addRow);
}

function renderDepartmentList(job) {
  const list = document.getElementById('dept-assign-list');
  list.innerHTML = '';

  JOB_TAGS.forEach(dept => {
    const checked = job.departments.includes(dept);
    const wrap = document.createElement('div');
    wrap.className = 'dept-assign-item';
    wrap.innerHTML = `
      <label class="dept-assign-checkbox-row">
        <input type="checkbox" ${checked ? 'checked' : ''} />
        <span>${escapeHtml(dept)}</span>
      </label>
      <div class="dept-assign-checklist" ${checked ? '' : 'hidden'}></div>
    `;
    const checklistEl = wrap.querySelector('.dept-assign-checklist');
    if (checked) renderDeptChecklist(checklistEl, job, dept);

    wrap.querySelector('input[type="checkbox"]').addEventListener('change', e => {
      if (e.target.checked) {
        job.departments = [...job.departments, dept];
        if (!job.departmentChecklists[dept]) job.departmentChecklists[dept] = [];
        checklistEl.hidden = false;
        renderDeptChecklist(checklistEl, job, dept);
      } else {
        job.departments = job.departments.filter(d => d !== dept);
        checklistEl.hidden = true;
        checklistEl.innerHTML = '';
      }
      persist(job);
    });

    list.appendChild(wrap);
  });
}

/** @param {string} jobKey */
export function openDepartmentAssign(jobKey) {
  const job = findJob(jobKey);
  if (!job) return;
  if (!job.departments) job.departments = [];
  if (!job.departmentChecklists) job.departmentChecklists = {};

  document.getElementById('dept-assign-title').textContent = `${job.jobNum ? job.jobNum + ' — ' : ''}${job.title}`;
  renderDepartmentList(job);
  document.getElementById('dept-assign-overlay').classList.add('open');
}

export function closeDepartmentAssign() {
  document.getElementById('dept-assign-overlay').classList.remove('open');
}
