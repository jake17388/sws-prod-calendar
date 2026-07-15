import { updateJobDepartments, toggleDepartmentTaskDone } from '../api.js';
import { patchJob } from '../state.js';
import { JOB_TAGS } from '../config.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Persists the job's full departments/departmentChecklists state after any
// change — used by the Admin/Manager editor, which owns the whole thing.
function persist(job) {
  updateJobDepartments(job.jobKey, job.departments, job.departmentChecklists).catch(() => {});
  patchJob(job.jobKey, { departments: job.departments, departmentChecklists: job.departmentChecklists });
}

function renderEditableChecklist(container, job, dept) {
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
      renderEditableChecklist(container, job, dept);
    });
    row.querySelector('input[type="text"]').addEventListener('change', e => {
      item.text = e.target.value.trim();
      persist(job);
    });
    row.querySelector('.checklist-remove').addEventListener('click', () => {
      job.departmentChecklists[dept] = items.filter(i => i.id !== item.id);
      persist(job);
      renderEditableChecklist(container, job, dept);
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
    renderEditableChecklist(container, job, dept);
  };
  addRow.querySelector('button').addEventListener('click', doAdd);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  container.appendChild(addRow);
}

/**
 * Full editor for Admin/Manager: checkbox per department, and for any
 * checked department an inline add/edit/remove checklist. Works whether the
 * job already has departments assigned or none yet — this is what both a
 * normal job click and a "Jobs to Assign" click land on for these roles.
 * @param {HTMLElement} container @param {object} job
 */
export function renderDepartmentEditor(container, job) {
  container.innerHTML = '';

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
    if (checked) renderEditableChecklist(checklistEl, job, dept);

    wrap.querySelector('input[type="checkbox"]').addEventListener('change', e => {
      if (e.target.checked) {
        job.departments = [...job.departments, dept];
        if (!job.departmentChecklists[dept]) job.departmentChecklists[dept] = [];
        checklistEl.hidden = false;
        renderEditableChecklist(checklistEl, job, dept);
      } else {
        job.departments = job.departments.filter(d => d !== dept);
        checklistEl.hidden = true;
        checklistEl.innerHTML = '';
      }
      persist(job);
    });

    container.appendChild(wrap);
  });
}

/**
 * Toggle-only view for a production-department account: just their own
 * department's checklist, no add/edit/remove, no other departments shown.
 * @param {HTMLElement} container @param {object} job @param {string} department
 */
export function renderOwnDepartmentTasks(container, job, department) {
  container.innerHTML = '';
  const items = job.departmentChecklists[department] || [];

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'dept-tasks-empty';
    empty.textContent = 'No tasks yet.';
    container.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
    row.innerHTML = `
      <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done"></button>
      <span>${escapeHtml(item.text)}</span>
    `;
    row.querySelector('.checklist-check').addEventListener('click', () => {
      const nextDone = !item.done;
      toggleDepartmentTaskDone(job.jobKey, department, item.id, nextDone).then(res => {
        if (!res.success) return;
        item.done = nextDone;
        job.departmentChecklists = res.departmentChecklists;
        patchJob(job.jobKey, { departmentChecklists: res.departmentChecklists });
        renderOwnDepartmentTasks(container, job, department);
      });
    });
    container.appendChild(row);
  });
}

/**
 * Read-only breakdown of every assigned department's checklist — for
 * Viewers, who can see progress at a glance but never touch anything.
 * @param {HTMLElement} container @param {object} job
 */
export function renderDepartmentsReadOnly(container, job) {
  container.innerHTML = '';

  job.departments.forEach(dept => {
    const section = document.createElement('div');
    section.className = 'dept-assign-item';
    const items = job.departmentChecklists[dept] || [];
    const itemsHtml = items.length
      ? items.map(i => `<div class="checklist-item ${i.done ? 'done' : ''}"><span class="checklist-check ${i.done ? 'checked' : ''}"></span><span>${escapeHtml(i.text)}</span></div>`).join('')
      : '<div class="dept-tasks-empty">No tasks yet.</div>';
    section.innerHTML = `
      <div class="dept-assign-checkbox-row"><span>${escapeHtml(dept)}</span></div>
      <div class="dept-assign-checklist">${itemsHtml}</div>
    `;
    container.appendChild(section);
  });
}
