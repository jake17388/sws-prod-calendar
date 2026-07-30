import { addNote, updateNote, deleteNote } from '../api.js';
import { patchJob } from '../state.js';
import { currentUser, isAdmin } from '../auth.js';
import { abbreviateName, formatTimestamp } from '../dates.js';
import { showToast } from '../toast.js';

function noteStampText(note) {
  if (!note.author) return 'Unknown';
  return note.createdAt ? `${abbreviateName(note.author)} · ${formatTimestamp(note.createdAt)}` : abbreviateName(note.author);
}

/**
 * Renders a list of authored, timestamped notes plus an "Add note" button
 * that reveals a small inline form — shared by project notes (jobDetail.js,
 * scope 'project') and department notes (departmentAssign.js, scope
 * 'department', with `department` set). A note can only be edited or
 * deleted by whoever wrote it; an Admin can touch any note.
 * @param {HTMLElement} container
 * @param {object} job
 * @param {'project'|'department'} scope
 * @param {string} department — required when scope is 'department'
 * @param {{ canWrite: boolean }} options — whether this viewer may add a
 *   note at all (edit/delete is decided per-note, by authorship)
 */
export function renderNotes(container, job, scope, department, { canWrite }) {
  container.innerHTML = '';

  const readList = () => (scope === 'project' ? (job.notes || []) : ((job.departmentNotes && job.departmentNotes[department]) || []));
  let list = readList();

  const listEl = document.createElement('div');
  listEl.className = 'notes-list';
  container.appendChild(listEl);

  function applyResult(res) {
    job.notes = res.notes;
    job.departmentNotes = res.departmentNotes;
    job.updatedAt = res.updatedAt;
    patchJob(job.jobKey, { notes: res.notes, departmentNotes: res.departmentNotes, updatedAt: res.updatedAt });
    list = readList();
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-empty';
      empty.textContent = 'No notes yet.';
      listEl.appendChild(empty);
      return;
    }
    list.forEach(renderNoteRow);
  }

  function renderNoteRow(note) {
    const canEdit = canWrite && (isAdmin() || (note.author && note.author === currentUser()));
    const row = document.createElement('div');
    row.className = 'note-item';

    const textEl = document.createElement('div');
    textEl.className = 'note-item-text';
    textEl.textContent = note.text;
    row.appendChild(textEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'note-item-meta';
    const stamp = document.createElement('span');
    stamp.className = 'note-item-stamp';
    stamp.textContent = noteStampText(note);
    metaEl.appendChild(stamp);
    row.appendChild(metaEl);

    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.className = 'note-action-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => startEdit(note, row));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'note-action-btn danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        deleteBtn.disabled = true;
        deleteNote(job.jobKey, scope, department, note.id)
          .then(res => {
            if (!res.success) { showToast(res.error || 'Failed to delete note', 'error'); deleteBtn.disabled = false; return; }
            applyResult(res);
          })
          .catch(() => { showToast('Failed to delete note', 'error'); deleteBtn.disabled = false; });
      });

      metaEl.appendChild(editBtn);
      metaEl.appendChild(deleteBtn);
    }

    listEl.appendChild(row);
  }

  function startEdit(note, row) {
    row.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'notes-textarea';
    textarea.value = note.text;
    row.appendChild(textarea);
    row.appendChild(editFormActions(
      () => renderList(),
      () => {
        const text = textarea.value.trim();
        if (!text) return null;
        return updateNote(job.jobKey, scope, department, note.id, text);
      },
    ));
    textarea.focus();
  }

  // Shared Save/Cancel row for both the edit form and the add form below.
  // `onSave` returns the in-flight request promise (or null to no-op on
  // empty input); `onCancel` restores whatever was showing before;
  // `onSuccess` (optional) runs after a successful save, for cleanup
  // specific to the caller (add's form resets to the "+ Add note" button —
  // edit's doesn't need one, applyResult's renderList() already replaces it).
  function editFormActions(onCancel, onSave, onSuccess) {
    const actions = document.createElement('div');
    actions.className = 'note-edit-actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-action primary';
    saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-action';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    cancelBtn.addEventListener('click', onCancel);
    saveBtn.addEventListener('click', () => {
      const req = onSave();
      if (!req) return;
      saveBtn.disabled = true;
      req
        .then(res => {
          if (!res.success) { showToast(res.error || 'Failed to save note', 'error'); saveBtn.disabled = false; return; }
          applyResult(res);
          if (onSuccess) onSuccess();
        })
        .catch(() => { showToast('Failed to save note', 'error'); saveBtn.disabled = false; });
    });
    return actions;
  }

  renderList();

  if (!canWrite) return;

  const addWrap = document.createElement('div');
  addWrap.className = 'notes-add-wrap';
  container.appendChild(addWrap);

  const addBtn = document.createElement('button');
  addBtn.className = 'notes-add-btn';
  addBtn.textContent = '+ Add note';
  addWrap.appendChild(addBtn);

  const resetAddForm = () => {
    addWrap.innerHTML = '';
    addWrap.appendChild(addBtn);
  };

  addBtn.addEventListener('click', () => {
    addWrap.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'notes-textarea';
    textarea.placeholder = 'Add a note…';
    addWrap.appendChild(textarea);
    addWrap.appendChild(editFormActions(
      resetAddForm,
      () => {
        const text = textarea.value.trim();
        return text ? addNote(job.jobKey, scope, department, text) : null;
      },
      resetAddForm,
    ));
    textarea.focus();
  });
}
