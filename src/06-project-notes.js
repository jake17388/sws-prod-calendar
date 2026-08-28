// ── Shared project notes ────────────────────────────────────────────────────
// Every interactive authenticated user who can view a job can add a note to
// its shared timeline. TV is a long-lived display session and stays read-only.
function canWriteNote(actor) {
  return !!actor && actor.department !== 'TV';
}

// Only the person who wrote a note can edit or delete it — an Admin is the
// one exception, who can touch any note. Mirrors the checklist-task
// completion rule, but simpler: there's no "if you wrote it" carve-out for
// Managers here the way there is for un-checking a task — a Manager can
// edit/delete only their own notes, full stop.
function canEditNote(actor, note) {
  if (actor.department === 'Admin') return true;
  if (note.authorId) return note.authorId === actor.id;
  return note.author === actor.name; // legacy notes created before immutable attribution
}

function noteScopeAndDept(data) {
  // Treat requests from a briefly cached pre-upgrade frontend as project
  // notes too, so a note can never be written into a retired hidden scope.
  const scope = data.scope === 'project' || data.scope === 'department' ? 'project' : '';
  return { scope, department: '' };
}

function addNote(actor, data) {
  const { scope } = noteScopeAndDept(data);
  if (!scope) return { success: false, error: 'Invalid note scope' };
  if (!validJobKey(data.jobKey)) return { success: false, error: 'Invalid job key' };
  const text = String(data.text || '').trim();
  if (!validText(text, 2000)) return { success: false, error: 'Note must be 1–2000 characters' };
  const requestedId = String(data.noteId || '').trim();
  if (requestedId.length > 100 || /[^A-Za-z0-9_-]/.test(requestedId)) return { success: false, error: 'Invalid note id' };

  return setTracking(data.jobKey, current => {
    if (current.completed) return { error: 'Job is complete — reopen it to add notes' };
    if (!canWriteNote(actor)) return { error: 'forbidden' };
    const currentList = current.notes || [];
    if (currentList.length >= 200) return { error: 'This note list has reached its 200-note limit' };
    const noteId = requestedId || Utilities.getUuid();
    // A retry with the same client-generated id is idempotent, preventing a
    // slow first response plus a retry from creating duplicate notes.
    if (currentList.some(note => note.id === noteId)) return { notes: currentList };
    const note = { id: noteId, text, author: actor.name, authorId: actor.id, createdAt: new Date().toISOString() };
    const list = [...currentList, note];
    return { notes: list };
  }, actor.name);
}

function updateNote(actor, data) {
  const { scope } = noteScopeAndDept(data);
  if (!scope) return { success: false, error: 'Invalid note scope' };
  if (!validJobKey(data.jobKey)) return { success: false, error: 'Invalid job key' };
  const text = String(data.text || '').trim();
  if (!validText(text, 2000)) return { success: false, error: 'Note must be 1–2000 characters' };
  if (!data.noteId || String(data.noteId).length > 100) return { success: false, error: 'Invalid note id' };

  return setTracking(data.jobKey, current => {
    if (current.completed) return { error: 'Job is complete — reopen it to edit notes' };
    if (!canWriteNote(actor)) return { error: 'forbidden' };
    const list = current.notes || [];
    const existing = list.find(n => n.id === data.noteId);
    if (!existing) return { error: 'Note not found' };
    if (!canEditNote(actor, existing)) return { error: 'Only the author or an Admin can edit this note' };
    const updatedList = list.map(n => (n.id === data.noteId ? { ...n, text } : n));
    return { notes: updatedList };
  }, actor.name);
}

function deleteNote(actor, data) {
  const { scope } = noteScopeAndDept(data);
  if (!scope) return { success: false, error: 'Invalid note scope' };
  if (!validJobKey(data.jobKey)) return { success: false, error: 'Invalid job key' };
  if (!data.noteId || String(data.noteId).length > 100) return { success: false, error: 'Invalid note id' };

  return setTracking(data.jobKey, current => {
    if (current.completed) return { error: 'Job is complete — reopen it to delete notes' };
    if (!canWriteNote(actor)) return { error: 'forbidden' };
    const list = current.notes || [];
    const existing = list.find(n => n.id === data.noteId);
    if (!existing) return { error: 'Note not found' };
    if (!canEditNote(actor, existing)) return { error: 'Only the author or an Admin can delete this note' };
    const updatedList = list.filter(n => n.id !== data.noteId);
    return { notes: updatedList };
  }, actor.name);
}

// A production-department account (Manufacturing, Graphics, etc.) can only
// toggle the done state of an existing task in its OWN department's
// checklist — never another department's, never add/remove/retext items,
// and never touch which departments are assigned or current. That's
// deliberately narrower than updateJobDepartments (Admin/Manager) so a
// lower-privilege client can't smuggle in unrelated changes through this
// endpoint. Requires the department to be *assigned* to the job (not
// necessarily current — a job stays visible and workable for a department
// the whole time it's assigned, see getProductionJobs). Checking a task off
// is always allowed; un-checking one is only allowed for whoever completed
// it — otherwise one department member could erase a teammate's completed
// record. Also locked once the whole job is marked complete.
function toggleDepartmentTaskDone(actor, data) {
  const department = String(data.department || '');
  if (JOB_DEPARTMENTS.indexOf(department) === -1 || actor.department !== department) {
    return { success: false, error: 'forbidden' };
  }
  if (!validJobKey(data.jobKey)) return { success: false, error: 'Invalid job key' };

  const tracking = getAllTracking();
  const current = tracking[String(data.jobKey)] || { completed: false, departments: [], departmentChecklists: {}, currentDepartments: [] };
  if (current.completed) return { success: false, error: 'Job is complete — reopen it to edit departments' };
  if (current.departments.indexOf(department) === -1) return { success: false, error: 'Not your department\'s job' };

  const itemId = String(data.itemId || '');
  const items = current.departmentChecklists[department] || [];
  const prevItem = items.find(i => i.id === itemId);
  if (!prevItem) return { success: false, error: 'Task not found' };

  const requestedDone = !!data.done;
  if (prevItem.done && !requestedDone && (prevItem.doneById ? prevItem.doneById !== actor.id : prevItem.doneBy !== actor.name)) {
    return { success: false, error: 'Only the person who completed this task can un-check it' };
  }

  const transitionAt = new Date().toISOString();
  const updatedItems = items.map(i => (i.id === itemId ? stampChecklistItem({ ...i, done: requestedDone }, prevItem, actor.name, actor.id, transitionAt) : i));
  const departmentChecklists = { ...current.departmentChecklists, [department]: updatedItems };

  // Checking off the last open task hands the department back — it's no
  // longer "currently" holding the job. Paint is the workflow exception: its
  // final completion immediately hands the job to Assembly below. Same base
  // rule updateJobDepartments enforces for the Admin/Manager editor.
  const patch = { departmentChecklists };
  if (updatedItems.length && updatedItems.every(i => i.done)) {
    patch.currentDepartments = current.currentDepartments.filter(d => d !== department);
  }

  if (department === 'Paint') {
    const advanced = advancePaintToAssembly(
      { ...current, ...patch },
      items,
      actor,
      transitionAt,
    );
    patch.departments = advanced.departments;
    patch.departmentChecklists = advanced.departmentChecklists;
    patch.currentDepartments = advanced.currentDepartments;
  }

  return setTracking(data.jobKey, patch, actor.name);
}
