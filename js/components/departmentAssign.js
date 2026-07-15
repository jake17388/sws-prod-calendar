import { updateJobDepartments, toggleDepartmentTaskDone } from '../api.js';
import { patchJob } from '../state.js';
import { currentUser } from '../auth.js';
import { JOB_TAGS } from '../config.js';
import { abbreviateName, formatTimestamp } from '../dates.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stampHtml(item) {
  if (!item.done || !item.doneBy) return '';
  return `<span class="checklist-item-stamp">Completed by: ${escapeHtml(abbreviateName(item.doneBy))} on ${escapeHtml(formatTimestamp(item.doneAt))}</span>`;
}

// Persists the job's full departments/departmentChecklists/currentDepartments
// state after any change — used by the Admin/Manager editor, which owns the
// whole thing. Reconciles with the server's response afterward since it's
// the source of truth for who/when completed each task.
// `rerender`, when given, repaints the caller's view from the reconciled
// `job` — needed on a conflict (someone else's edit landed first, so the
// server's version wins) since it differs from what's already painted.
function persist(job, rerender) {
  const expectedUpdatedAt = job.updatedAt;
  updateJobDepartments(job.jobKey, job.departments, job.departmentChecklists, job.currentDepartments, expectedUpdatedAt)
    .then(res => {
      if (!res.success && res.error !== 'conflict') return;
      job.departments = res.departments;
      job.departmentChecklists = res.departmentChecklists;
      job.currentDepartments = res.currentDepartments;
      job.updatedAt = res.updatedAt;
      patchJob(job.jobKey, { departments: res.departments, departmentChecklists: res.departmentChecklists, currentDepartments: res.currentDepartments, updatedAt: res.updatedAt });
      if (res.error === 'conflict' && rerender) rerender();
    })
    .catch(() => {});
  patchJob(job.jobKey, { departments: job.departments, departmentChecklists: job.departmentChecklists, currentDepartments: job.currentDepartments });
}

function renderEditableChecklist(container, job, dept) {
  container.innerHTML = '';
  const items = job.departmentChecklists[dept] || [];

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
    row.innerHTML = `
      <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done"></button>
      <div class="checklist-item-main">
        <input type="text" value="${item.text.replace(/"/g, '&quot;')}" />
        ${stampHtml(item)}
      </div>
      <button class="checklist-remove" aria-label="Remove item">&times;</button>
    `;
    row.querySelector('.checklist-check').addEventListener('click', () => {
      item.done = !item.done;
      item.doneBy = item.done ? currentUser() : '';
      item.doneAt = item.done ? new Date().toISOString() : '';
      persist(job, () => renderEditableChecklist(container, job, dept));
      renderEditableChecklist(container, job, dept);
    });
    row.querySelector('input[type="text"]').addEventListener('change', e => {
      item.text = e.target.value.trim();
      persist(job, () => renderEditableChecklist(container, job, dept));
    });
    row.querySelector('.checklist-remove').addEventListener('click', () => {
      job.departmentChecklists[dept] = items.filter(i => i.id !== item.id);
      persist(job, () => renderEditableChecklist(container, job, dept));
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
    job.departmentChecklists[dept] = [...(job.departmentChecklists[dept] || []), { id: `${Date.now()}`, text, done: false, doneBy: '', doneAt: '' }];
    addInput.value = '';
    persist(job, () => renderEditableChecklist(container, job, dept));
    renderEditableChecklist(container, job, dept);
  };
  addRow.querySelector('button').addEventListener('click', doAdd);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  container.appendChild(addRow);
}

// Read-only rendering of a department's checklist with completion stamps —
// used both for the Admin/Manager editor once the job is locked (complete)
// and for Viewers.
function renderStaticChecklist(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'dept-tasks-empty';
    empty.textContent = 'No tasks.';
    container.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
    row.innerHTML = `
      <span class="checklist-check ${item.done ? 'checked' : ''}"></span>
      <div class="checklist-item-main">
        <span class="checklist-item-text">${escapeHtml(item.text)}</span>
        ${stampHtml(item)}
      </div>
    `;
    container.appendChild(row);
  });
}

/**
 * Full editor for Admin/Manager: checkbox per department for "this job needs
 * them", and — for any checked department — a second "currently has it"
 * checkbox plus an inline add/edit/remove checklist. Multiple departments
 * can be current at once (parallel work), and there's no enforced order;
 * Managers move a job from one department to another just by flipping these
 * checkboxes as work progresses. Works whether the job already has
 * departments assigned or none yet — this is what both a normal job click
 * and a "Jobs to Assign" click land on for these roles.
 *
 * Once the whole job is marked complete, this locks: department checkboxes
 * gray out, "Currently has it" disappears entirely, and checklists become
 * read-only (still showing who completed what and when) — reopen the job
 * (uncheck "Mark job complete") to edit again.
 * @param {HTMLElement} container @param {object} job
 */
export function renderDepartmentEditor(container, job) {
  container.innerHTML = '';
  const locked = !!job.completed;

  JOB_TAGS.forEach(dept => {
    const needed = job.departments.includes(dept);
    const isCurrent = job.currentDepartments.includes(dept);
    const wrap = document.createElement('div');
    wrap.className = 'dept-assign-item';
    wrap.innerHTML = `
      <label class="dept-assign-checkbox-row">
        <input type="checkbox" class="dept-needed-checkbox" ${needed ? 'checked' : ''} ${locked ? 'disabled' : ''} />
        <span>${escapeHtml(dept)}</span>
      </label>
      ${locked ? '' : `
      <label class="dept-current-row" ${needed ? '' : 'hidden'}>
        <input type="checkbox" class="dept-current-checkbox" ${isCurrent ? 'checked' : ''} />
        <span>Currently has it</span>
      </label>`}
      <div class="dept-assign-checklist" ${needed ? '' : 'hidden'}></div>
    `;
    const checklistEl = wrap.querySelector('.dept-assign-checklist');
    if (needed) {
      if (locked) renderStaticChecklist(checklistEl, job.departmentChecklists[dept] || []);
      else renderEditableChecklist(checklistEl, job, dept);
    }

    if (!locked) {
      const currentRow = wrap.querySelector('.dept-current-row');

      wrap.querySelector('.dept-needed-checkbox').addEventListener('change', e => {
        if (e.target.checked) {
          job.departments = [...job.departments, dept];
          if (!job.departmentChecklists[dept]) job.departmentChecklists[dept] = [];
          currentRow.hidden = false;
          checklistEl.hidden = false;
          renderEditableChecklist(checklistEl, job, dept);
        } else {
          job.departments = job.departments.filter(d => d !== dept);
          job.currentDepartments = job.currentDepartments.filter(d => d !== dept);
          currentRow.hidden = true;
          currentRow.querySelector('.dept-current-checkbox').checked = false;
          checklistEl.hidden = true;
          checklistEl.innerHTML = '';
        }
        persist(job, () => renderDepartmentEditor(container, job));
      });

      currentRow.querySelector('.dept-current-checkbox').addEventListener('change', e => {
        job.currentDepartments = e.target.checked
          ? [...job.currentDepartments, dept]
          : job.currentDepartments.filter(d => d !== dept);
        persist(job, () => renderDepartmentEditor(container, job));
      });
    }

    container.appendChild(wrap);
  });
}

/**
 * Toggle-only view for a production-department account: just their own
 * department's checklist, no add/edit/remove, no other departments shown.
 * Locks to read-only once the whole job is marked complete.
 * @param {HTMLElement} container @param {object} job @param {string} department
 */
export function renderOwnDepartmentTasks(container, job, department) {
  container.innerHTML = '';
  const locked = !!job.completed;
  const items = job.departmentChecklists[department] || [];

  if (locked) {
    renderStaticChecklist(container, items);
    return;
  }

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
      <div class="checklist-item-main">
        <span class="checklist-item-text">${escapeHtml(item.text)}</span>
        ${stampHtml(item)}
      </div>
    `;
    row.querySelector('.checklist-check').addEventListener('click', () => {
      const nextDone = !item.done;
      const prevDoneBy = item.doneBy;
      const prevDoneAt = item.doneAt;
      item.done = nextDone;
      item.doneBy = nextDone ? currentUser() : '';
      item.doneAt = nextDone ? new Date().toISOString() : '';
      patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
      renderOwnDepartmentTasks(container, job, department);
      toggleDepartmentTaskDone(job.jobKey, department, item.id, nextDone)
        .then(res => {
          if (res.success) { job.departmentChecklists = res.departmentChecklists; return; }
          item.done = !nextDone;
          item.doneBy = prevDoneBy;
          item.doneAt = prevDoneAt;
          patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
          renderOwnDepartmentTasks(container, job, department);
        })
        .catch(() => {
          item.done = !nextDone;
          item.doneBy = prevDoneBy;
          item.doneAt = prevDoneAt;
          patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
          renderOwnDepartmentTasks(container, job, department);
        });
    });
    container.appendChild(row);
  });
}

/**
 * Read-only breakdown of every assigned department's checklist — for
 * Viewers, who can see progress at a glance but never touch anything.
 * Departments currently holding the job are marked so it's clear where it
 * actually sits right now, not just which departments it'll eventually need.
 * @param {HTMLElement} container @param {object} job
 */
export function renderDepartmentsReadOnly(container, job) {
  container.innerHTML = '';

  job.departments.forEach(dept => {
    const isCurrent = job.currentDepartments.includes(dept);
    const section = document.createElement('div');
    section.className = 'dept-assign-item';
    section.innerHTML = `
      <div class="dept-assign-checkbox-row"><span>${escapeHtml(dept)}</span>${isCurrent ? '<span class="dept-current-tag">Current</span>' : ''}</div>
      <div class="dept-assign-checklist"></div>
    `;
    renderStaticChecklist(section.querySelector('.dept-assign-checklist'), job.departmentChecklists[dept] || []);
    container.appendChild(section);
  });
}
