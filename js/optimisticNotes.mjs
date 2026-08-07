export function addPendingNote(notes, note) {
  return [...notes, { ...note, pending: true }];
}

export function removePendingNote(notes, noteId) {
  return notes.filter(note => note.id !== noteId);
}

export function markNoteDeleting(notes, noteId) {
  return notes.map(note => (note.id === noteId ? { ...note, deleting: true } : note));
}

export function restoreDeletingNote(notes, noteId) {
  return notes.map(note => {
    if (note.id !== noteId) return note;
    const { deleting, ...restored } = note;
    return restored;
  });
}

// Server responses are authoritative for saved notes, but they may have been
// generated before a newer local save finished. Keep any still-pending local
// notes that the response cannot know about yet.
export function preservePendingNotes(localNotes, serverNotes) {
  const deleting = localNotes.filter(note => note.deleting);
  const deletingIds = new Set(deleting.map(note => note.id));
  const visibleServerNotes = serverNotes.filter(note => !deletingIds.has(note.id));
  const serverIds = new Set(visibleServerNotes.map(note => note.id));
  const pending = localNotes.filter(note => note.pending && !note.deleting && !serverIds.has(note.id));
  return [...visibleServerNotes, ...pending, ...deleting];
}

export function settlePendingNote(localNotes, noteId, serverNotes) {
  const saved = serverNotes.find(note => note.id === noteId);
  if (!saved) return localNotes;
  return preservePendingNotes(localNotes, serverNotes);
}

export function settleDeletedNote(localNotes, noteId, serverNotes) {
  const remainingLocal = localNotes.filter(note => note.id !== noteId);
  const remainingServer = serverNotes.filter(note => note.id !== noteId);
  return preservePendingNotes(remainingLocal, remainingServer);
}

export function preservePendingNotesInJobs(currentJobs, nextJobs) {
  const currentByKey = new Map(currentJobs.map(job => [job.jobKey, job]));
  return nextJobs.map(nextJob => {
    const current = currentByKey.get(nextJob.jobKey);
    if (!current) return nextJob;

    const notes = preservePendingNotes(current.notes || [], nextJob.notes || []);
    const departmentNotes = { ...(nextJob.departmentNotes || {}) };
    const departments = new Set([
      ...Object.keys(current.departmentNotes || {}),
      ...Object.keys(departmentNotes),
    ]);
    departments.forEach(department => {
      departmentNotes[department] = preservePendingNotes(
        (current.departmentNotes && current.departmentNotes[department]) || [],
        departmentNotes[department] || [],
      );
    });
    return { ...nextJob, notes, departmentNotes };
  });
}
