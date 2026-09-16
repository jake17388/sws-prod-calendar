export function normalizeJobNote(value) {
  return String(value || '').trim().slice(0, 1000);
}

export function createJobNoteState({ entryId = '', jobNum = '', jobName = '', note = '' } = {}) {
  const savedNote = String(note || '');
  return {
    entryId,
    jobNum,
    jobName,
    savedNote,
    draft: savedNote,
    saving: false,
    get dirty() { return this.draft !== this.savedNote; },
    setDraft(value) { this.draft = String(value || ''); },
    valueToSave() { return normalizeJobNote(this.draft); },
    canCloseWithoutConfirmation() { return !this.dirty; },
    async save(saveNote) {
      this.saving = true;
      try {
        const value = this.valueToSave();
        const result = await saveNote(value);
        if (!result || !result.success) throw new Error(result?.error || 'Could not save note');
        this.savedNote = String(result.notes ?? value);
        this.draft = this.savedNote;
        return result;
      } finally {
        this.saving = false;
      }
    },
  };
}

export function shouldSaveJobNote(state) {
  return !state.saving && normalizeJobNote(state.draft) !== normalizeJobNote(state.savedNote);
}

export function jobNoteShortcut(event) {
  if (event.key === 'Escape') return 'close';
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) return 'save';
  return null;
}
