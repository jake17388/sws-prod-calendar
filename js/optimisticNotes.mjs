export function addPendingNote(notes, note) {
  return [...notes, { ...note, pending: true }];
}

export function removePendingNote(notes, noteId) {
  return notes.filter(note => note.id !== noteId);
}

// Server responses are authoritative for saved notes, but they may have been
// generated before a newer local save finished. Keep any still-pending local
// notes that the response cannot know about yet.
export function preservePendingNotes(localNotes, serverNotes) {
  const serverIds = new Set(serverNotes.map(note => note.id));
  const pending = localNotes.filter(note => note.pending && !serverIds.has(note.id));
  return [...serverNotes, ...pending];
}

export function settlePendingNote(localNotes, noteId, serverNotes) {
  const saved = serverNotes.find(note => note.id === noteId);
  if (!saved) return localNotes;
  return preservePendingNotes(localNotes, serverNotes);
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
