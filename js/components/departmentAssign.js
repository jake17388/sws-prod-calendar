import { updateJobDepartments, toggleDepartmentTaskDone } from '../api.js';
import { patchJob } from '../state.js';
import { currentUser, isAdmin } from '../auth.js';
import { JOB_TAGS } from '../config.js';
import { abbreviateName, formatTimestamp } from '../dates.js';
import { beginRequest, isLatestRequest } from '../requestSequence.js';
import { renderNotes } from './notes.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stampHtml(item) {
  if (!item.done || !item.doneBy) return '';
  return `<span class="checklist-item-stamp">Completed by: ${escapeHtml(abbreviateName(item.doneBy))} on ${escapeHtml(formatTimestamp(item.doneAt))}</span>`;
}

// One entry per job, tracking whether a save is currently in flight and
// whether another change landed locally while it was — see persist() below.
const saveQueues = new Map();

// Persists the job's full departments/departmentChecklists/currentDepartments
// state after any change — used by the Admin/Manager editor, which owns the
// whole thing. Reconciles with the server's response afterward since it's
// the source of truth for who/when completed each task.
// `rerender`, when given, repaints the caller's view from the reconciled
// `job` — needed on a conflict (someone else's edit landed first, so the
// server's version wins) since it differs from what's already painted.
//
// Every call sends the job's `updatedAt` as an optimistic-concurrency
// token, and the server rejects a stale one with a 'conflict'. Two of our
// own saves in flight at once (e.g. two checklist clicks a beat apart)
// would race: whichever request the server processes second always finds
// `updatedAt` has already moved from the first, gets rejected, and its
// response then overwrites the just-applied first change with the
// server's older copy — the checkbox visibly "un-clicks" itself. Queuing
// to at most one in-flight save per job, and re-sending the latest local
// state the moment the current one finishes, means every request we send
// carries an `updatedAt` we know is current, so we never conflict with
// ourselves — only a genuine edit from someone else can still do that.
function persist(job, rerender) {
  patchJob(job.jobKey, { departments: job.departments, departmentChecklists: job.departmentChecklists, currentDepartments: job.currentDepartments });

  let queue = saveQueues.get(job.jobKey);
  if (!queue) { queue = { saving: false, dirty: false, rerender: null }; saveQueues.set(job.jobKey, queue); }
  queue.rerender = rerender; // always the latest caller's — used if a queued resend ends in a real conflict
  if (queue.saving) { queue.dirty = true; return; }
  sendPersist(job, queue);
}

function sendPersist(job, queue) {
  queue.saving = true;
  queue.dirty = false;
  const expectedUpdatedAt = job.updatedAt;
  updateJobDepartments(job.jobKey, job.departments, job.departmentChecklists, job.currentDepartments, expectedUpdatedAt)
    .then(res => {
      if (!res.success && res.error !== 'conflict') return;
      job.updatedAt = res.updatedAt;
      // A newer local edit landed while this request was in flight — its
      // state already supersedes this response, so don't let this response
      // stomp it. It'll be sent (with the now-current updatedAt) below.
      if (queue.dirty) return;
      // The server silently drops a department from currentDepartments the
      // moment its last open task gets checked off (see
      // updateJobDepartments/toggleDepartmentTaskDone in Code.js) — that
      // isn't reflected by the caller's own optimistic re-render (which only
      // repaints the checklist it just edited, not the sibling "Currently
      // has it" checkbox), so force a full rerender whenever this response's
      // currentDepartments differs from what was sent.
      const currentDepartmentsChanged = JSON.stringify(job.currentDepartments) !== JSON.stringify(res.currentDepartments);
      job.departments = res.departments;
      job.departmentChecklists = res.departmentChecklists;
      job.currentDepartments = res.currentDepartments;
      job.departmentNotes = res.departmentNotes;
      patchJob(job.jobKey, { departments: res.departments, departmentChecklists: res.departmentChecklists, currentDepartments: res.currentDepartments, departmentNotes: res.departmentNotes, updatedAt: res.updatedAt });
      if ((res.error === 'conflict' || currentDepartmentsChanged) && queue.rerender) queue.rerender();
    })
    .catch(() => {})
    .finally(() => {
      queue.saving = false;
      if (queue.dirty) sendPersist(job, queue);
    });
}

// A department can only be "currently" holding the job while it has an open
// (not-done) task — Ship-In is the exception (see renderDepartmentEditor's
// self-heal comment, it has no checklist-driven workflow of its own).
// Mirrors the same rule enforced server-side in updateJobDepartments/
// toggleDepartmentTaskDone.
function hasOpenTask(job, dept) {
  return dept === 'Ship-In' || (job.departmentChecklists[dept] || []).some(i => !i.done);
}

// Keeps the "Currently has it" button's enabled/active state in sync with
// hasOpenTask immediately after a checklist edit, without waiting on the
// server round-trip that sendPersist's rerender above also handles — this
// just makes the common case (completing the last task) feel instant.
// `container` is any element inside the department's .dept-assign-item.
function syncCurrentButtonState(container, job, dept) {
  const btn = container.closest('.dept-assign-item')?.querySelector('.dept-current-btn');
  if (!btn) return;
  const open = hasOpenTask(job, dept);
  btn.disabled = !open;
  if (!open) btn.classList.remove('active');
}

function renderEditableChecklist(container, job, dept) {
  container.innerHTML = '';
  const items = job.departmentChecklists[dept] || [];
  // Once a task is done, only an Admin can un-check or delete it — a
  // Manager can't erase the paper trail of who completed what and when.
  // Mirrors the server-side enforcement in updateJobDepartments.
  const canUndo = isAdmin();

  items.forEach(item => {
    const locked = item.done && !canUndo;
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
    row.innerHTML = `
      <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done" ${locked ? 'disabled title="Only an Admin can un-check a completed task"' : ''}></button>
      <div class="checklist-item-main">
        <input type="text" value="${item.text.replace(/"/g, '&quot;')}" />
        ${stampHtml(item)}
      </div>
      ${locked ? '' : '<button class="checklist-remove" aria-label="Remove item">&times;</button>'}
    `;
    if (!locked) {
      row.querySelector('.checklist-check').addEventListener('click', () => {
        item.done = !item.done;
        item.doneBy = item.done ? currentUser() : '';
        item.doneAt = item.done ? new Date().toISOString() : '';
        persist(job, () => renderEditableChecklist(container, job, dept));
        renderEditableChecklist(container, job, dept);
        syncCurrentButtonState(container, job, dept);
      });
    }
    row.querySelector('input[type="text"]').addEventListener('change', e => {
      item.text = e.target.value.trim();
      persist(job, () => renderEditableChecklist(container, job, dept));
    });
    if (!locked) {
      row.querySelector('.checklist-remove').addEventListener('click', () => {
        job.departmentChecklists[dept] = items.filter(i => i.id !== item.id);
        persist(job, () => renderEditableChecklist(container, job, dept));
        renderEditableChecklist(container, job, dept);
        syncCurrentButtonState(container, job, dept);
      });
    }
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
    syncCurrentButtonState(container, job, dept);
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

// Department notes for one department on one job — a list of authored,
// timestamped notes (see notes.js), writable by Admin, Manager, or whoever
// is logged in as that specific department. `canWrite` covers the job-level
// lock (whole job complete) and any role that can't write at all (Viewers,
// other departments) — same as before, just delegated to the shared
// component instead of a single free-text textarea per department.
function renderDeptNotes(container, job, dept, canWrite) {
  renderNotes(container, job, 'department', dept, { canWrite });
}

/**
 * Full editor for Admin/Manager: checkbox per department for "this job needs
 * them", and — for any checked department other than Ship-In — a second
 * "currently has it" checkbox plus an inline add/edit/remove checklist and a
 * free-text notes box. Ship-In has no "currently has it" toggle: it means
 * the job was made elsewhere and just shipped in to us, so it's implicitly
 * current for as long as it's needed (see the self-heal below). Multiple
 * departments can be current at once (parallel work), and there's no
 * enforced order; Managers move a job from one department to another just by
 * flipping these checkboxes as work progresses. Works whether the job
 * already has departments assigned or none yet — this is what both a normal
 * job click and a "Jobs to Assign" click land on for these roles.
 *
 * Once the whole job is marked complete, this locks: department checkboxes
 * gray out, "Currently has it" disappears entirely, and checklists/notes
 * become read-only (still showing who completed what and when) — reopen the
 * job (uncheck "Mark job complete") to edit again.
 * @param {HTMLElement} container @param {object} job
 */
export function renderDepartmentEditor(container, job) {
  container.innerHTML = '';
  const locked = !!job.completed;

  // Self-heal: a Ship-In tag with no "currently has it" toggle should always
  // read as current while it's needed — fixes up any job saved before this
  // toggle was removed, without needing a one-off migration script.
  if (!locked && job.departments.includes('Ship-In') && !job.currentDepartments.includes('Ship-In')) {
    job.currentDepartments = [...job.currentDepartments, 'Ship-In'];
    persist(job);
  }

  JOB_TAGS.forEach(dept => {
    const needed = job.departments.includes(dept);
    const isCurrent = job.currentDepartments.includes(dept);
    const showCurrentToggle = dept !== 'Ship-In';
    const openTask = hasOpenTask(job, dept);
    const wrap = document.createElement('div');
    wrap.className = 'dept-assign-item';
    wrap.innerHTML = `
      <div class="dept-assign-checkbox-row">
        <label class="dept-assign-checkbox-label">
          <input type="checkbox" class="dept-needed-checkbox" ${needed ? 'checked' : ''} ${locked ? 'disabled' : ''} />
          <span>${escapeHtml(dept)}</span>
        </label>
        ${locked || !showCurrentToggle ? '' : `
        <button type="button" class="dept-current-btn ${isCurrent ? 'active' : ''}" ${needed ? '' : 'hidden'} ${openTask ? '' : 'disabled'}>Currently has it</button>`}
      </div>
      <div class="dept-assign-checklist" ${needed ? '' : 'hidden'}></div>
      <div class="dept-assign-notes" ${needed ? '' : 'hidden'}></div>
    `;
    const checklistEl = wrap.querySelector('.dept-assign-checklist');
    const notesEl = wrap.querySelector('.dept-assign-notes');
    if (needed) {
      if (locked) renderStaticChecklist(checklistEl, job.departmentChecklists[dept] || []);
      else renderEditableChecklist(checklistEl, job, dept);
      renderDeptNotes(notesEl, job, dept, !locked);
    }

    if (!locked) {
      const currentBtn = wrap.querySelector('.dept-current-btn');

      wrap.querySelector('.dept-needed-checkbox').addEventListener('change', e => {
        if (e.target.checked) {
          job.departments = [...job.departments, dept];
          if (!job.departmentChecklists[dept]) job.departmentChecklists[dept] = [];
          if (dept === 'Ship-In' && !job.currentDepartments.includes('Ship-In')) {
            job.currentDepartments = [...job.currentDepartments, 'Ship-In'];
          }
          if (currentBtn) {
            currentBtn.hidden = false;
            // Starts with an empty checklist — no open task yet, so
            // "Currently has it" starts disabled until one's added.
            syncCurrentButtonState(currentBtn, job, dept);
          }
          checklistEl.hidden = false;
          notesEl.hidden = false;
          renderEditableChecklist(checklistEl, job, dept);
          renderDeptNotes(notesEl, job, dept, true);
        } else {
          job.departments = job.departments.filter(d => d !== dept);
          job.currentDepartments = job.currentDepartments.filter(d => d !== dept);
          if (currentBtn) {
            currentBtn.hidden = true;
            currentBtn.classList.remove('active');
          }
          checklistEl.hidden = true;
          checklistEl.innerHTML = '';
          notesEl.hidden = true;
          notesEl.innerHTML = '';
        }
        persist(job, () => renderDepartmentEditor(container, job));
      });

      if (currentBtn) {
        currentBtn.addEventListener('click', () => {
          const nextCurrent = !job.currentDepartments.includes(dept);
          job.currentDepartments = nextCurrent
            ? [...job.currentDepartments, dept]
            : job.currentDepartments.filter(d => d !== dept);
          currentBtn.classList.toggle('active', nextCurrent);
          persist(job, () => renderDepartmentEditor(container, job));
        });
      }
    }

    container.appendChild(wrap);
  });
}

/**
 * Toggle-only view for a production-department account: just their own
 * department's checklist plus its notes box, no add/edit/remove, no other
 * departments shown. Locks to read-only once the whole job is marked
 * complete.
 * @param {HTMLElement} container @param {object} job @param {string} department
 */
export function renderOwnDepartmentTasks(container, job, department) {
  container.innerHTML = '';
  const locked = !!job.completed;
  const items = job.departmentChecklists[department] || [];

  const tasksEl = document.createElement('div');
  container.appendChild(tasksEl);

  if (locked) {
    renderStaticChecklist(tasksEl, items);
  } else if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'dept-tasks-empty';
    empty.textContent = 'No tasks yet.';
    tasksEl.appendChild(empty);
  } else {
    items.forEach(item => {
      // Checking a task is always allowed; un-checking one is only allowed
      // for whoever completed it — otherwise a teammate could erase your
      // completed record (or vice versa). Mirrored server-side in
      // toggleDepartmentTaskDone as the actual enforcement.
      const canToggle = !item.done || item.doneBy === currentUser();
      const row = document.createElement('div');
      row.className = `checklist-item ${item.done ? 'done' : ''}`.trim();
      row.innerHTML = `
        <button class="checklist-check ${item.done ? 'checked' : ''}" aria-label="Toggle done" ${canToggle ? '' : `disabled title="Only ${escapeHtml(item.doneBy || 'whoever completed this')} can un-check this task"`}></button>
        <div class="checklist-item-main">
          <span class="checklist-item-text">${escapeHtml(item.text)}</span>
          ${stampHtml(item)}
        </div>
      `;
      if (!canToggle) { tasksEl.appendChild(row); return; }
      row.querySelector('.checklist-check').addEventListener('click', () => {
        const nextDone = !item.done;
        const prevDoneBy = item.doneBy;
        const prevDoneAt = item.doneAt;
        // Rapid clicks fire overlapping requests whose responses can
        // resolve out of order — only the most recently fired toggle for
        // this exact item is allowed to apply its result, so a slow stale
        // response can't flip the checkbox back on its own.
        const requestKey = `dept-task:${job.jobKey}:${department}:${item.id}`;
        const token = beginRequest(requestKey);
        item.done = nextDone;
        item.doneBy = nextDone ? currentUser() : '';
        item.doneAt = nextDone ? new Date().toISOString() : '';
        patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
        renderOwnDepartmentTasks(container, job, department);
        toggleDepartmentTaskDone(job.jobKey, department, item.id, nextDone)
          .then(res => {
            if (!isLatestRequest(requestKey, token)) return;
            if (res.success) { job.departmentChecklists = res.departmentChecklists; return; }
            item.done = !nextDone;
            item.doneBy = prevDoneBy;
            item.doneAt = prevDoneAt;
            patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
            renderOwnDepartmentTasks(container, job, department);
          })
          .catch(() => {
            if (!isLatestRequest(requestKey, token)) return;
            item.done = !nextDone;
            item.doneBy = prevDoneBy;
            item.doneAt = prevDoneAt;
            patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
            renderOwnDepartmentTasks(container, job, department);
          });
      });
      tasksEl.appendChild(row);
    });
  }

  const notesEl = document.createElement('div');
  notesEl.className = 'dept-assign-notes dept-own-notes';
  container.appendChild(notesEl);
  renderDeptNotes(notesEl, job, department, !locked);
}

/**
 * Read-only breakdown of every assigned department's checklist and notes —
 * for Viewers, who can see progress at a glance but never touch anything.
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
      <div class="dept-assign-checkbox-row"><span class="dept-assign-checkbox-label">${escapeHtml(dept)}</span>${isCurrent ? '<span class="dept-current-tag">Current</span>' : ''}</div>
      <div class="dept-assign-checklist"></div>
      <div class="dept-assign-notes"></div>
    `;
    renderStaticChecklist(section.querySelector('.dept-assign-checklist'), job.departmentChecklists[dept] || []);
    renderDeptNotes(section.querySelector('.dept-assign-notes'), job, dept, false);
    container.appendChild(section);
  });
}
