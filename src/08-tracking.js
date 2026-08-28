// ── Tracking (completed / notes / checklist) ────────────────────────────────
// Lazily creates its own spreadsheet on first use and remembers the ID in
// Script Properties, so there's no manual Sheet-ID setup step. Shared with
// the Squarecoil Production File cache below (a second tab in the same spreadsheet)
// rather than a separate file, so there's still only one Sheet-ID to manage.
function getTrackingSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('TRACKING_SHEET_ID');
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('SWS Production Tracking');
    props.setProperty('TRACKING_SHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.appendRow(['job_key', 'completed', 'notes', 'checklist_json', 'updated_at', 'updated_by', 'completed_at', 'completed_by', 'due_override', 'departments_json', 'department_checklists_json', 'current_departments_json', 'department_notes_json', 'additional_files_json', 'archive_snapshot_json']);
    // Plain-text format on the date-shaped columns so Sheets doesn't
    // auto-coerce "2026-08-15" into an actual Date cell.
    sheet.getRange('G:I').setNumberFormat('@');
  }
  return ss;
}

function getTrackingSheet() {
  const sheet = getTrackingSpreadsheet().getSheets()[0];
  if (sheet.getRange(1, 14).getValue() !== 'additional_files_json') {
    sheet.getRange(1, 14).setValue('additional_files_json');
  }
  if (sheet.getRange(1, 15).getValue() !== 'archive_snapshot_json') {
    sheet.getRange(1, 15).setValue('archive_snapshot_json');
  }
  return sheet;
}

// Notes used to be a single free-text field — now each is a list of authored,
// timestamped note objects
// ({id, text, author, createdAt}) instead, so multiple notes can be added
// and each one attributed and individually editable/deletable. Old plain-
// text content is migrated into a single note the first time it's read
// (rather than silently dropped) — it has no real author, so only an Admin
// can edit/delete it (see canEditNote).
function parseNotesCell(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) { /* legacy plain-text note, handled below */ }
  return [{ id: 'legacy', text: String(raw), author: '', createdAt: '' }];
}

function parseDepartmentNotesCell(raw) {
  let obj = {};
  try { obj = raw ? JSON.parse(raw) : {}; } catch (err) { obj = {}; }
  const result = {};
  Object.keys(obj).forEach(dept => {
    const val = obj[dept];
    if (Array.isArray(val)) { result[dept] = val; return; }
    result[dept] = (typeof val === 'string' && val.trim())
      ? [{ id: 'legacy', text: val, author: '', createdAt: '' }]
      : [];
  });
  return result;
}

function parseAdditionalFilesCell(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function parseArchiveSnapshotCell(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

// Department notes were retired in August 2026. Fold every legacy note into
// the shared project timeline on read, preserving attribution and timestamps.
// Repeated reads are safe: duplicate IDs/content are collapsed, and the next
// write stores the merged list while clearing the legacy column.
function mergeLegacyDepartmentNotes(projectNotes, departmentNotes) {
  const merged = (Array.isArray(projectNotes) ? projectNotes : []).map(note => ({ ...note }));
  const signature = note => [note.text || '', note.author || '', note.authorId || '', note.createdAt || ''].join('\u0001');
  const usedIds = new Map();
  merged.forEach(note => { if (note.id) usedIds.set(String(note.id), signature(note)); });

  Object.keys(departmentNotes || {}).sort().forEach(department => {
    const notes = Array.isArray(departmentNotes[department]) ? departmentNotes[department] : [];
    notes.forEach((source, index) => {
      const note = { ...source };
      const noteSignature = signature(note);
      let id = String(note.id || '');
      if (id && usedIds.get(id) === noteSignature) return;
      if (!id || usedIds.has(id)) {
        const base = `legacy-${String(department).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'department'}-${index + 1}`;
        id = base;
        let suffix = 2;
        while (usedIds.has(id)) id = `${base}-${suffix++}`;
        note.id = id;
      }
      usedIds.set(id, noteSignature);
      merged.push(note);
    });
  });

  return merged
    .map((note, index) => ({ note, index }))
    .sort((a, b) => {
      const aTime = Date.parse(a.note.createdAt || '');
      const bTime = Date.parse(b.note.createdAt || '');
      if (Number.isNaN(aTime) || Number.isNaN(bTime) || aTime === bTime) return a.index - b.index;
      return aTime - bTime;
    })
    .map(entry => entry.note);
}

function getAllTracking() {
  const sheet = getTrackingSheet();
  const data = sheet.getDataRange().getValues();
  const tracking = {};
  for (let i = 1; i < data.length; i++) {
    const [jobKey, completed, notes, checklistJson, updatedAt, , completedAt, completedBy, dueOverride, departmentsJson, departmentChecklistsJson, currentDepartmentsJson, departmentNotesJson, additionalFilesJson, archiveSnapshotJson] = data[i];
    if (!jobKey) continue;
    // A duplicate job_key row (see dedupeTrackingSheet) must resolve the
    // same way setTracking's own row-finder does — first occurrence wins —
    // or a write to the first row can silently get overwritten right back
    // by a stale second row on the very next read.
    if (Object.prototype.hasOwnProperty.call(tracking, String(jobKey))) continue;
    let checklist = [];
    try { checklist = checklistJson ? JSON.parse(checklistJson) : []; } catch (err) { checklist = []; }
    let departments = [];
    try { departments = departmentsJson ? JSON.parse(departmentsJson) : []; } catch (err) { departments = []; }
    let departmentChecklists = {};
    try { departmentChecklists = departmentChecklistsJson ? JSON.parse(departmentChecklistsJson) : {}; } catch (err) { departmentChecklists = {}; }
    let currentDepartments = [];
    try { currentDepartments = currentDepartmentsJson ? JSON.parse(currentDepartmentsJson) : []; } catch (err) { currentDepartments = []; }
    tracking[String(jobKey)] = {
      completed: !!completed, notes: mergeLegacyDepartmentNotes(parseNotesCell(notes), parseDepartmentNotesCell(departmentNotesJson)), checklist,
      updatedAt: updatedAt || '',
      completedAt: completedAt || '', completedBy: completedBy || '',
      dueOverride: normalizeDateCell(dueOverride),
      departments, departmentChecklists, currentDepartments,
      additionalFiles: parseAdditionalFilesCell(additionalFilesJson),
      archiveSnapshot: parseArchiveSnapshotCell(archiveSnapshotJson),
    };
  }
  return tracking;
}

// One-time cleanup for duplicate job_key rows already in the sheet (e.g.
// job 260162 had two — a fresh "completed" row and a stale leftover
// "incomplete" one, which kept clobbering the fresh one back on every
// read; see getAllTracking's comment for the read-side fix). Keeps the
// first occurrence of each job_key — same resolution order setTracking's
// row-finder and getAllTracking both use — and deletes the rest. Not
// wired to any UI action; run manually from the Apps Script editor
// (Run > dedupeTrackingSheet) if duplicates are ever suspected again.
// Logs how many rows it removed.
function dedupeTrackingSheet() {
  const sheet = getTrackingSheet();
  const data = sheet.getDataRange().getValues();
  const seen = new Set();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const jobKey = String(data[i][0]);
    if (!jobKey) continue;
    if (seen.has(jobKey)) {
      rowsToDelete.push(i + 1);
    } else {
      seen.add(jobKey);
    }
  }
  // Delete bottom-up so earlier row indexes stay valid as rows shift up.
  rowsToDelete.sort((a, b) => b - a).forEach(rowIndex => sheet.deleteRow(rowIndex));
  Logger.log('Removed %s duplicate row(s)', rowsToDelete.length);
  return rowsToDelete.length;
}

// `expectedUpdatedAt`, when passed, is the updatedAt the caller last read
// this job at. Callers that submit a full-replace patch (notes text, the
// whole departmentChecklists object) get rejected with a 'conflict' if
// someone else's write landed first — otherwise their patch, built from a
// stale local copy, would silently drop the other person's change even
// though this write is itself safely serialized by the lock below. Callers
// that only flip a single field (toggleComplete, toggleDepartmentTaskDone)
// don't need this — `current` below is always re-read fresh under the lock,
// so a single-field patch can never clobber unrelated concurrent changes.
//
// `patch` can also be a function of `current` — for callers (addNote/
// updateNote/deleteNote) that need to build their patch FROM the current
// value of a field (appending to a notes list, checking who wrote an entry)
// rather than just overwrite it. Without this they'd need their own
// getAllTracking() call first to see that current value, which parses
// every JSON field on every row in the whole sheet just to read one job —
// doubling the cost of what's otherwise a single cheap row read here.
// Returning `{ error }` from the function rejects the write without ever
// touching the sheet.
function setTracking(jobKey, patch, user, expectedUpdatedAt) {
  if (!validJobKey(jobKey)) return { success: false, error: 'Invalid job key' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getTrackingSheet();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(jobKey)) { rowIndex = i + 1; break; }
    }
    const current = rowIndex === -1
      ? { completed: false, notes: [], checklist: [], updatedAt: '', completedAt: '', completedBy: '', dueOverride: '', departments: [], departmentChecklists: {}, currentDepartments: [], additionalFiles: [], archiveSnapshot: null }
      : {
          completed: !!data[rowIndex - 1][1],
          notes: mergeLegacyDepartmentNotes(parseNotesCell(data[rowIndex - 1][2]), parseDepartmentNotesCell(data[rowIndex - 1][12])),
          checklist: (() => { try { return JSON.parse(data[rowIndex - 1][3] || '[]'); } catch (e) { return []; } })(),
          updatedAt: data[rowIndex - 1][4] || '',
          completedAt: data[rowIndex - 1][6] || '',
          completedBy: data[rowIndex - 1][7] || '',
          dueOverride: normalizeDateCell(data[rowIndex - 1][8]),
          departments: (() => { try { return JSON.parse(data[rowIndex - 1][9] || '[]'); } catch (e) { return []; } })(),
          departmentChecklists: (() => { try { return JSON.parse(data[rowIndex - 1][10] || '{}'); } catch (e) { return {}; } })(),
          currentDepartments: (() => { try { return JSON.parse(data[rowIndex - 1][11] || '[]'); } catch (e) { return []; } })(),
          additionalFiles: parseAdditionalFilesCell(data[rowIndex - 1][13]),
          archiveSnapshot: parseArchiveSnapshotCell(data[rowIndex - 1][14]),
        };

    if (expectedUpdatedAt && rowIndex !== -1 && current.updatedAt && expectedUpdatedAt !== current.updatedAt) {
      return { success: false, error: 'conflict', ...current };
    }

    const resolvedPatch = typeof patch === 'function' ? patch(current) : patch;
    if (resolvedPatch && resolvedPatch.error) return { success: false, error: resolvedPatch.error };

    const next = { ...current, ...resolvedPatch };
    // completedAt/completedBy only change on an actual complete/un-complete
    // toggle (patch.completed present) — editing notes or the checklist
    // shouldn't touch who/when it was marked done.
    if (resolvedPatch.completed !== undefined) {
      next.completedAt = resolvedPatch.completed ? new Date().toISOString() : '';
      next.completedBy = resolvedPatch.completed ? user : '';
    }
    next.updatedAt = new Date().toISOString();
    if (!validDateOverride(next.dueOverride)) return { success: false, error: 'Invalid due date' };
    const notesJson = JSON.stringify(next.notes);
    const checklistJson = JSON.stringify(next.checklist);
    const departmentsJson = JSON.stringify(next.departments);
    const departmentChecklistsJson = JSON.stringify(next.departmentChecklists);
    const currentDepartmentsJson = JSON.stringify(next.currentDepartments);
    const additionalFilesJson = JSON.stringify(next.additionalFiles || []);
    const archiveSnapshotJson = JSON.stringify(next.archiveSnapshot || null);
    const departmentNotesJson = '{}'; // retained as an empty compatibility column
    if ([notesJson, checklistJson, departmentsJson, departmentChecklistsJson, currentDepartmentsJson, additionalFilesJson, archiveSnapshotJson].some(value => value.length > 45000)) {
      return { success: false, error: 'Job data is too large to save' };
    }
    const row = [String(jobKey), next.completed, notesJson, checklistJson, next.updatedAt, sanitizeSheetText(user), next.completedAt, sanitizeSheetText(next.completedBy), next.dueOverride, departmentsJson, departmentChecklistsJson, currentDepartmentsJson, departmentNotesJson, additionalFilesJson, archiveSnapshotJson];
    if (rowIndex === -1) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    }
    bumpTrackingVersion();
    return { success: true, ...next };
  } catch (err) {
    console.error('setTracking failed for job %s: %s\n%s', jobKey, err && err.message, err && err.stack);
    return { success: false, error: 'Save failed — try again' };
  } finally {
    lock.releaseLock();
  }
}
