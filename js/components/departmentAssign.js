import { updateJobDepartments, toggleDepartmentTaskDone } from '../api.js';
import { patchJob } from '../state.js';
import { currentUser, currentUserId, isAdmin } from '../auth.js';
import { JOB_TAGS } from '../config.js';
import { abbreviateName, formatTimestamp } from '../dates.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';
import { showToast } from '../toast.js';
import { createKeyedDebouncer } from '../keyedDebouncer.mjs';
import { commonTasksForDepartment } from './commonTaskManagement.js';

function stampHtml(item) {
  if (!item.done || !item.doneBy) return '';
  return `<span class="checklist-item-stamp">Completed by: ${escapeHtml(abbreviateName(item.doneBy))} on ${escapeHtml(formatTimestamp(item.doneAt))}</span>`;
}

function addedStampHtml(item) {
  if (!item.addedBy || !item.addedAt) return '';
  return `<span class="checklist-item-stamp">Added by: ${escapeHtml(abbreviateName(item.addedBy))} on ${escapeHtml(formatTimestamp(item.addedAt))}</span>`;
}

// One entry per job, tracking whether a save is currently in flight and
// whether another change landed locally while it was — see persist() below.
const saveQueues = new Map();
const persistDebouncer = createKeyedDebouncer(180);
const taskToggleDebouncer = createKeyedDebouncer(220);
const taskToggleStates = new Map();

function markTaskSaving(item, saving) {
  if (saving) {
    Object.defineProperty(item, '_saving', { value: true, writable: true, configurable: true, enumerable: false });
  } else {
    delete item._saving;
  }
}

function clearTaskSaving(job) {
  Object.values(job.departmentChecklists || {}).flat().forEach(item => markTaskSaving(item, false));
}

function settleTaskSavingUi() {
  document.querySelectorAll('#job-detail-departments .checklist-item.is-saving').forEach(row => row.classList.remove('is-saving'));
  document.querySelectorAll('#job-detail-departments .checklist-check.saving').forEach(button => {
    button.classList.remove('saving');
    button.setAttribute('aria-busy', 'false');
  });
}

function editorHasActiveTextInput() {
  const active = document.activeElement;
  return !!active && active.matches('#job-detail-departments input[type="text"]');
}

function reconcileDepartmentChecklists(localByDepartment, serverByDepartment) {
  const reconciled = {};
  Object.entries(serverByDepartment || {}).forEach(([department, serverItems]) => {
    const localItemsById = new Map((localByDepartment[department] || []).map(item => [item.id, item]));
    reconciled[department] = serverItems.map(serverItem => {
      const localItem = localItemsById.get(serverItem.id);
      if (!localItem) return serverItem;
      Object.assign(localItem, serverItem);
      return localItem;
    });
  });
  return reconciled;
}

// Persists the job's full departments/departmentChecklists/currentDepartments
// state after any change — used by the Admin/Manager editor, which owns the
// whole thing. Reconciles with the server's response afterward since it's
// the source of truth for who/when completed each task.
// `rerender`, when given, is reserved for server-side structural workflow
// changes. Normal saves and conflicts leave the editor DOM in place.
//
// Every call sends the job's `updatedAt` as an optimistic-concurrency
// token, and the server rejects a stale one with a 'conflict'. Two of our
// own saves in flight at once (e.g. two checklist clicks a beat apart)
// would race: whichever request the server processes second always finds
// `updatedAt` has already moved from the first, gets rejected, and its
// response then overwrites the just-applied first change with the
// server's older copy — the checkbox visibly "un-clicks" itself. Queuing
// to at most one in-flight save per job, and re-sending the latest local
// state after the current one finishes and the brief input-coalescing window,
// means every request we send
// carries an `updatedAt` we know is current, so we never conflict with
// ourselves — only a genuine edit from someone else can still do that.
function persist(job, rerender) {
  patchJob(job.jobKey, { departments: job.departments, departmentChecklists: job.departmentChecklists, currentDepartments: job.currentDepartments });

  let queue = saveQueues.get(job.jobKey);
  if (!queue) { queue = { saving: false, dirty: false, rerender: null }; saveQueues.set(job.jobKey, queue); }
  queue.rerender = rerender; // always the latest caller's — used if a queued resend ends in a real conflict
  if (queue.saving) { queue.dirty = true; return; }
  persistDebouncer.schedule(job.jobKey, () => sendPersist(job, queue));
}

function sendPersist(job, queue) {
  queue.saving = true;
  queue.dirty = false;
  const expectedUpdatedAt = job.updatedAt;
  // Freeze the outgoing payload. The manager is free to keep changing the
  // live job object while this request is in flight; those newer edits set
  // queue.dirty and are sent as the next snapshot.
  const sent = {
    departments: [...job.departments],
    departmentChecklists: JSON.parse(JSON.stringify(job.departmentChecklists)),
    currentDepartments: [...job.currentDepartments],
  };
  updateJobDepartments(job.jobKey, sent.departments, sent.departmentChecklists, sent.currentDepartments, expectedUpdatedAt)
    .then(res => {
      if (res.error === 'conflict') {
        // A note or another editor moved updatedAt first. Keep every local
        // click and draft exactly where it is, adopt the fresh concurrency
        // token, and resend the latest local snapshot. Repainting with the
        // conflict response here used to erase all rapid department choices.
        job.updatedAt = res.updatedAt || job.updatedAt;
        queue.dirty = true;
        return;
      }
      if (!res.success) {
        // A rejected save (job locked, permission denied, validation) used to
        // return here silently, leaving the optimistic local edit on screen as
        // though it had been written. The next poll would quietly revert it.
        showToast(res.error || "Couldn't save department changes", 'error');
        clearTaskSaving(job);
        settleTaskSavingUi();
        return;
      }
      job.updatedAt = res.updatedAt;
      // A newer local edit landed while this request was in flight — its
      // state already supersedes this response, so don't let this response
      // stomp it. It'll be sent (with the now-current updatedAt) below.
      if (queue.dirty) return;
      const serverDepartments = Array.isArray(res.departments) ? res.departments : sent.departments;
      const serverChecklists = res.departmentChecklists || sent.departmentChecklists;
      const serverCurrentDepartments = Array.isArray(res.currentDepartments) ? res.currentDepartments : sent.currentDepartments;
      const structuralChange = JSON.stringify(sent.departments) !== JSON.stringify(serverDepartments)
        || JSON.stringify(sent.currentDepartments) !== JSON.stringify(serverCurrentDepartments);
      job.departments = serverDepartments;
      // Keep existing task objects alive so input listeners that are already
      // on screen continue editing the canonical job after this response.
      job.departmentChecklists = reconcileDepartmentChecklists(job.departmentChecklists, serverChecklists);
      job.currentDepartments = serverCurrentDepartments;
      clearTaskSaving(job);
      settleTaskSavingUi();
      patchJob(job.jobKey, { departments: job.departments, departmentChecklists: job.departmentChecklists, currentDepartments: job.currentDepartments, updatedAt: res.updatedAt });
      // Ordinary saves never rebuild the editor. A backend workflow transition
      // (for example Paint handing off to Assembly) may need a structural
      // repaint, but even that waits until the manager is not actively typing.
      if (structuralChange && !editorHasActiveTextInput() && queue.rerender) queue.rerender();
    })
    .catch(err => {
      // Network failure on a write. The edit is still sitting on screen looking
      // saved, so say so — the queue below will retry if a newer local change
      // arrives, but nothing else would ever tell the user this didn't land.
      console.error('Failed to save department changes:', err);
      showToast("Couldn't save department changes — check your connection", 'error');
      clearTaskSaving(job);
      settleTaskSavingUi();
    })
    .finally(() => {
      queue.saving = false;
      if (queue.dirty) persistDebouncer.schedule(job.jobKey, () => sendPersist(job, queue));
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
  // This editor is only rendered for Admins and Managers, and both can reopen
  // a completed task. Managers must reopen one before its remove control is
  // shown; Admins retain the ability to delete it directly.

  items.forEach(item => {
    const canDelete = !item.done || isAdmin();
    const row = document.createElement('div');
    row.className = `checklist-item ${item.done ? 'done' : ''} ${item._saving ? 'is-saving' : ''}`.trim();
    row.innerHTML = `
      <button class="checklist-check ${item.done ? 'checked' : ''} ${item._saving ? 'saving' : ''}" aria-label="Toggle done" aria-busy="${item._saving ? 'true' : 'false'}"></button>
      <div class="checklist-item-main">
        <input type="text" value="${escapeAttr(item.text)}" />
        ${addedStampHtml(item)}
        ${stampHtml(item)}
      </div>
      ${canDelete ? '<button class="checklist-remove" aria-label="Remove item">&times;</button>' : ''}
    `;
    row.querySelector('.checklist-check').addEventListener('click', () => {
      item.done = !item.done;
      item.doneBy = item.done ? currentUser() : '';
      item.doneById = item.done ? currentUserId() : '';
      item.doneAt = item.done ? new Date().toISOString() : '';
      markTaskSaving(item, true);
      persist(job, () => renderEditableChecklist(container, job, dept));
      renderEditableChecklist(container, job, dept);
      syncCurrentButtonState(container, job, dept);
    });
    const textInput = row.querySelector('input[type="text"]');
    textInput.addEventListener('input', e => {
      item.text = e.target.value;
    });
    textInput.addEventListener('change', e => {
      item.text = e.target.value.trim();
      e.target.value = item.text;
      persist(job, () => renderEditableChecklist(container, job, dept));
    });
    if (canDelete) {
      row.querySelector('.checklist-remove').addEventListener('click', () => {
        job.departmentChecklists[dept] = items.filter(i => i.id !== item.id);
        persist(job, () => renderEditableChecklist(container, job, dept));
        renderEditableChecklist(container, job, dept);
        syncCurrentButtonState(container, job, dept);
      });
    }
    container.appendChild(row);
  });

  const quickTasks = commonTasksForDepartment(dept);
  if (quickTasks.length) {
    const quickWrap = document.createElement('div');
    quickWrap.className = 'common-task-buttons';
    quickTasks.forEach(task => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'common-task-button';
      button.textContent = task.text;
      button.addEventListener('click', () => {
        const now = new Date().toISOString();
        job.departmentChecklists[dept] = [...(job.departmentChecklists[dept] || []), {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: task.text,
          done: false,
          doneBy: '',
          doneById: '',
          doneAt: '',
          addedBy: currentUser(),
          addedById: currentUserId(),
          addedAt: now,
        }];
        persist(job, () => renderEditableChecklist(container, job, dept));
        renderEditableChecklist(container, job, dept);
        syncCurrentButtonState(container, job, dept);
      });
      quickWrap.appendChild(button);
    });
    container.appendChild(quickWrap);
  }

  const addRow = document.createElement('div');
  addRow.className = 'checklist-add';
  addRow.innerHTML = '<input type="text" placeholder="Add item…" /><button>Add</button>';
  const addInput = addRow.querySelector('input');
  const doAdd = () => {
    const text = addInput.value.trim();
    if (!text) return;
    const now = new Date().toISOString();
    job.departmentChecklists[dept] = [...(job.departmentChecklists[dept] || []), { id: `${Date.now()}`, text, done: false, doneBy: '', doneById: '', doneAt: '', addedBy: currentUser(), addedById: currentUserId(), addedAt: now }];
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
        ${addedStampHtml(item)}
        ${stampHtml(item)}
      </div>
    `;
    container.appendChild(row);
  });
}

function restoreTask(item, baseline) {
  item.done = baseline.done;
  item.doneBy = baseline.doneBy;
  item.doneById = baseline.doneById;
  item.doneAt = baseline.doneAt;
  markTaskSaving(item, false);
}

function sendOwnTaskToggle(container, job, department, itemId, key) {
  const state = taskToggleStates.get(key);
  if (!state || state.inFlight) return;
  const sent = state.desired;
  state.inFlight = true;

  toggleDepartmentTaskDone(job.jobKey, department, itemId, sent)
    .then(res => {
      if (!res.success) throw new Error(res.error || 'Could not update task');
      state.inFlight = false;
      if (state.desired !== sent) {
        taskToggleDebouncer.schedule(key, () => sendOwnTaskToggle(container, job, department, itemId, key), 0);
        return;
      }
      taskToggleStates.delete(key);
      job.departmentChecklists = res.departmentChecklists;
      if (res.departments) job.departments = res.departments;
      if (res.currentDepartments) job.currentDepartments = res.currentDepartments;
      patchJob(job.jobKey, {
        departmentChecklists: job.departmentChecklists,
        departments: job.departments,
        currentDepartments: job.currentDepartments,
        updatedAt: res.updatedAt,
      });
      renderOwnDepartmentTasks(container, job, department);
    })
    .catch(err => {
      state.inFlight = false;
      if (state.desired !== sent) {
        taskToggleDebouncer.schedule(key, () => sendOwnTaskToggle(container, job, department, itemId, key), 0);
        return;
      }
      const currentItem = (job.departmentChecklists[department] || []).find(candidate => candidate.id === itemId);
      if (currentItem) restoreTask(currentItem, state.baseline);
      taskToggleStates.delete(key);
      patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
      renderOwnDepartmentTasks(container, job, department);
      showToast(err.message || "Couldn't update task — check your connection", 'error');
    });
}

function queueOwnTaskToggle(container, job, department, item) {
  const key = `dept-task:${job.jobKey}:${department}:${item.id}`;
  let state = taskToggleStates.get(key);
  if (!state) {
    state = {
      baseline: { done: item.done, doneBy: item.doneBy, doneById: item.doneById, doneAt: item.doneAt },
      desired: item.done,
      inFlight: false,
    };
    taskToggleStates.set(key, state);
  }

  state.desired = !item.done;
  item.done = state.desired;
  item.doneBy = item.done ? currentUser() : '';
  item.doneById = item.done ? currentUserId() : '';
  item.doneAt = item.done ? new Date().toISOString() : '';
  markTaskSaving(item, true);

  if (!state.inFlight && state.desired === state.baseline.done) {
    taskToggleDebouncer.cancel(key);
    restoreTask(item, state.baseline);
    taskToggleStates.delete(key);
  } else {
    taskToggleDebouncer.schedule(key, () => sendOwnTaskToggle(container, job, department, item.id, key));
  }

  patchJob(job.jobKey, { departmentChecklists: job.departmentChecklists });
  renderOwnDepartmentTasks(container, job, department);
}

/**
 * Full editor for Admin/Manager: checkbox per department for "this job needs
 * them", and — for any checked department other than Ship-In — a second
 * "currently has it" checkbox plus an inline add/edit/remove checklist and a
 * task list. Ship-In has no "currently has it" toggle: it means
 * the job was made elsewhere and just shipped in to us, so it's implicitly
 * current for as long as it's needed (see the self-heal below). Multiple
 * departments can be current at once (parallel work), and there's no
 * enforced order; Managers move a job from one department to another just by
 * flipping these checkboxes as work progresses. Works whether the job
 * already has departments assigned or none yet — this is what both a normal
 * job click and a "Jobs to Assign" click land on for these roles.
 *
 * Once the whole job is marked complete, this locks: department checkboxes
 * gray out, "Currently has it" disappears entirely, and checklists
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
    `;
    const checklistEl = wrap.querySelector('.dept-assign-checklist');
    if (needed) {
      if (locked) renderStaticChecklist(checklistEl, job.departmentChecklists[dept] || []);
      else renderEditableChecklist(checklistEl, job, dept);
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
          renderEditableChecklist(checklistEl, job, dept);
        } else {
          job.departments = job.departments.filter(d => d !== dept);
          job.currentDepartments = job.currentDepartments.filter(d => d !== dept);
          if (currentBtn) {
            currentBtn.hidden = true;
            currentBtn.classList.remove('active');
          }
          checklistEl.hidden = true;
          checklistEl.innerHTML = '';
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
 * department's checklist, no add/edit/remove, no other
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
      const canToggle = !item.done || (item.doneById ? item.doneById === currentUserId() : item.doneBy === currentUser());
      const row = document.createElement('div');
      row.className = `checklist-item ${item.done ? 'done' : ''} ${item._saving ? 'is-saving' : ''}`.trim();
      row.innerHTML = `
        <button class="checklist-check ${item.done ? 'checked' : ''} ${item._saving ? 'saving' : ''}" aria-label="Toggle done" aria-busy="${item._saving ? 'true' : 'false'}" ${canToggle ? '' : `disabled title="Only ${escapeAttr(item.doneBy || 'whoever completed this')} can un-check this task"`}></button>
        <div class="checklist-item-main">
          <span class="checklist-item-text">${escapeHtml(item.text)}</span>
          ${addedStampHtml(item)}
          ${stampHtml(item)}
        </div>
      `;
      if (!canToggle) { tasksEl.appendChild(row); return; }
      row.querySelector('.checklist-check').addEventListener('click', () => queueOwnTaskToggle(container, job, department, item));
      tasksEl.appendChild(row);
    });
  }
}

/**
 * Read-only breakdown of every assigned department's checklist —
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
    `;
    renderStaticChecklist(section.querySelector('.dept-assign-checklist'), job.departmentChecklists[dept] || []);
    container.appendChild(section);
  });
}
