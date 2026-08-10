import { addNote, updateNote, deleteNote } from '../api.js';
import { findJob, patchJob } from '../state.js';
import { currentUser, currentUserId, isAdmin } from '../auth.js';
import { abbreviateName, formatTimestamp } from '../dates.js';
import { showToast } from '../toast.js';
import { addPendingNote, markNoteDeleting, preservePendingNotesInJobs, removePendingNote, restoreDeletingNote, settleDeletedNote } from '../optimisticNotes.mjs';

// A save may finish after the job panel was closed and reopened. Keep the
// latest renderer for each note list so that response updates the visible
// list, not the detached DOM created by the earlier panel instance.
const renderedNoteLists = new Map();

function noteStampText(note) {
  if (note.pending) return 'Saving…';
  if (!note.author) return 'Unknown';
  return note.createdAt ? `${abbreviateName(note.author)} · ${formatTimestamp(note.createdAt)}` : abbreviateName(note.author);
}

/**
 * Renders the shared project timeline plus an "Add note" button. A note can
 * only be edited or deleted by whoever wrote it; an Admin can touch any note.
 * @param {HTMLElement} container
 * @param {object} job
 * @param {{ canWrite: boolean }} options — whether this viewer may add a
 *   note at all (edit/delete is decided per-note, by authorship)
 */
export function renderNotes(container, job, { canWrite }) {
  container.innerHTML = '';
  const renderKey = job.jobKey;

  const listFor = source => source.notes || [];
  const readList = () => listFor(job);
  const readLatestList = () => listFor(findJob(job.jobKey) || job);
  let list = readList();

  function writeList(nextList) {
    job.notes = nextList;
    patchJob(job.jobKey, { notes: nextList });
    list = nextList;
  }

  const listEl = document.createElement('div');
  listEl.className = 'notes-list';
  container.appendChild(listEl);

  function applyResult(res, settledDeleteId) {
    // Never let an older server response erase a newer note that is still
    // saving locally. Once the server response contains its client-generated
    // id, the saved server version naturally replaces the pending copy.
    const latest = findJob(job.jobKey) || job;
    const merged = preservePendingNotesInJobs(
      [latest],
      [{ ...res, jobKey: job.jobKey }],
    )[0];
    if (settledDeleteId) {
      const settled = settleDeletedNote(listFor(latest), settledDeleteId, listFor(merged));
      merged.notes = settled;
    }
    job.notes = merged.notes;
    job.updatedAt = res.updatedAt;
    patchJob(job.jobKey, { notes: job.notes, updatedAt: res.updatedAt });
    refreshVisibleList();
  }

  function renderList() {
    listEl.innerHTML = '';
    const visibleNotes = list.filter(note => !note.deleting);
    if (!visibleNotes.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-empty';
      empty.textContent = 'No notes yet.';
      listEl.appendChild(empty);
      return;
    }
    visibleNotes.forEach(renderNoteRow);
  }

  renderedNoteLists.set(renderKey, () => {
    const latest = findJob(job.jobKey);
    if (latest) {
      job.notes = latest.notes;
      job.updatedAt = latest.updatedAt;
    }
    list = readList();
    renderList();
  });

  const refreshVisibleList = () => renderedNoteLists.get(renderKey)?.();

  function renderNoteRow(note) {
    const ownsNote = note.authorId ? note.authorId === currentUserId() : (note.author && note.author === currentUser());
    const canEdit = !note.pending && canWrite && (isAdmin() || ownsNote);
    const row = document.createElement('div');
    row.className = `note-item${note.pending ? ' pending' : ''}`;

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
        writeList(markNoteDeleting(readLatestList(), note.id));
        refreshVisibleList();
        deleteNote(job.jobKey, note.id)
          .then(res => {
            if (!res.success) {
              writeList(restoreDeletingNote(readLatestList(), note.id));
              refreshVisibleList();
              showToast(res.error || 'Failed to delete note', 'error');
              return;
            }
            applyResult(res, note.id);
          })
          .catch(() => {
            writeList(restoreDeletingNote(readLatestList(), note.id));
            refreshVisibleList();
            showToast('Failed to delete note', 'error');
          });
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
        return updateNote(job.jobKey, note.id, text);
      },
    ));
    textarea.focus();
  }

  // Shared Save/Cancel row for note edits.
  // `onSave` returns the in-flight request promise (or null to no-op on
  // empty input); `onCancel` restores whatever was showing before.
  function editFormActions(onCancel, onSave) {
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

  function addFormActions(textarea) {
    const actions = document.createElement('div');
    actions.className = 'note-edit-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-action';
    cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-action primary';
    saveBtn.textContent = 'Save';
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    cancelBtn.addEventListener('click', resetAddForm);
    saveBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) return;
      const noteId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const pending = {
        id: noteId,
        text,
        author: currentUser(),
        authorId: currentUserId(),
        createdAt: new Date().toISOString(),
      };

      // Show and persist the local copy before starting the slow Apps Script
      // request, so closing/reopening the job never makes the note vanish.
      writeList(addPendingNote(readLatestList(), pending));
      refreshVisibleList();
      resetAddForm();

      addNote(job.jobKey, text, noteId)
        .then(res => {
          if (!res.success) {
            writeList(removePendingNote(readLatestList(), noteId));
            refreshVisibleList();
            showToast(res.error || 'Failed to save note', 'error');
            return;
          }
          applyResult(res);
        })
        .catch(() => {
          writeList(removePendingNote(readLatestList(), noteId));
          refreshVisibleList();
          showToast('Failed to save note', 'error');
        });
    });
    return actions;
  }

  addBtn.addEventListener('click', () => {
    addWrap.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'notes-textarea';
    textarea.placeholder = 'Add a note…';
    addWrap.appendChild(textarea);
    addWrap.appendChild(addFormActions(textarea));
    textarea.focus();
  });
}
