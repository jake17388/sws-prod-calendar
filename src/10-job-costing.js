// ── Job costing time entries ────────────────────────────────────────────────
// Each row is one uninterrupted work segment. Starting a different job closes
// the employee's previous open segment and appends a new row; Stop Work only
// closes the current segment. Durable user ids preserve attribution even when
// an Admin later renames an account.
const JOB_TIME_SHEET_NAME = 'JobTimeEntries';
const JOB_TIME_BASE_HEADERS = [
  'entry_id', 'user_id', 'employee', 'department', 'job_number', 'job_name',
  'source', 'started_at', 'ended_at', 'duration_minutes', 'status',
];
const JOB_TIME_AUDIT_HEADERS = ['edited_at', 'edited_by', 'edited_by_id'];
const JOB_TIME_NOTE_HEADERS = ['notes'];
const JOB_TIME_HEADERS = JOB_TIME_BASE_HEADERS.concat(JOB_TIME_NOTE_HEADERS, JOB_TIME_AUDIT_HEADERS);

function getJobTimeEntriesSheet_() {
  const ss = getTrackingSpreadsheet();
  let sheet = ss.getSheetByName(JOB_TIME_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(JOB_TIME_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, JOB_TIME_HEADERS.length).setValues([JOB_TIME_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(2, 8, Math.max(1, sheet.getMaxRows ? sheet.getMaxRows() - 1 : 1), 2)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, 10, Math.max(1, sheet.getMaxRows ? sheet.getMaxRows() - 1 : 1), 1)
      .setNumberFormat('0.00');
    sheet.getRange(2, 12, Math.max(1, sheet.getMaxRows ? sheet.getMaxRows() - 1 : 1), 1)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    return sheet;
  }

  const header = (sheet.getDataRange().getValues()[0] || []).map(String);
  if (header.slice(0, JOB_TIME_BASE_HEADERS.length).join('|') !== JOB_TIME_BASE_HEADERS.join('|')) {
    throw new Error('JobTimeEntries sheet headers are not recognized');
  }
  const noteHeader = header[JOB_TIME_BASE_HEADERS.length] || '';
  if (!noteHeader) {
    if (header[JOB_TIME_BASE_HEADERS.length + 1] === JOB_TIME_AUDIT_HEADERS[0] && sheet.insertColumnAfter) {
      sheet.insertColumnAfter(JOB_TIME_BASE_HEADERS.length);
    }
    sheet.getRange(1, JOB_TIME_BASE_HEADERS.length + 1).setValue('notes');
  }
  const refreshedHeader = (sheet.getDataRange().getValues()[0] || []).map(String);
  const auditHeader = refreshedHeader.slice(JOB_TIME_BASE_HEADERS.length + 1, JOB_TIME_HEADERS.length);
  if (auditHeader.every(value => !value)) {
      sheet.getRange(1, JOB_TIME_BASE_HEADERS.length + 2, 1, JOB_TIME_AUDIT_HEADERS.length)
      .setValues([JOB_TIME_AUDIT_HEADERS]);
    sheet.getRange(2, 13, Math.max(1, sheet.getMaxRows ? sheet.getMaxRows() - 1 : 1), 1)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (auditHeader.join('|') !== JOB_TIME_AUDIT_HEADERS.join('|')) {
    throw new Error('JobTimeEntries sheet audit headers are not recognized');
  }
  return sheet;
}

function jobTimeNow_() {
  return new Date();
}

function jobTimeDate_(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jobTimeEntryFromRow_(row) {
  const started = jobTimeDate_(row[7]);
  return {
    entryId: String(row[0] || ''),
    userId: String(row[1] || ''),
    employee: String(row[2] || ''),
    department: String(row[3] || ''),
    jobNum: String(row[4] || ''),
    jobName: String(row[5] || ''),
    source: String(row[6] || ''),
    startedAt: started ? started.toISOString() : '',
    notes: row.length > 14 ? String(row[11] || '') : '',
  };
}

function jobTimeLogEntryFromRow_(row) {
  const legacy = row.length <= JOB_TIME_BASE_HEADERS.length + JOB_TIME_AUDIT_HEADERS.length;
  const started = jobTimeDate_(row[7]);
  const ended = jobTimeDate_(row[8]);
  const duration = row[9] === '' || row[9] == null ? null : Number(row[9]);
  return {
    entryId: String(row[0] || ''),
    userId: String(row[1] || ''),
    employee: String(row[2] || ''),
    department: String(row[3] || ''),
    jobNum: String(row[4] || ''),
    jobName: String(row[5] || ''),
    source: String(row[6] || ''),
    startedAt: started ? started.toISOString() : '',
    endedAt: ended ? ended.toISOString() : '',
    durationMinutes: Number.isFinite(duration) ? duration : null,
    status: String(row[10] || ''),
    notes: legacy ? '' : String(row[11] || ''),
    editedAt: jobTimeDate_(row[legacy ? 11 : 12]) ? jobTimeDate_(row[legacy ? 11 : 12]).toISOString() : '',
    editedBy: String(row[legacy ? 12 : 13] || ''),
  };
}

function normalizeJobTimeRange_(params) {
  const from = String((params && params.from) || '').trim();
  const to = String((params && params.to) || '').trim();
  if (!from && !to) return { from: '', to: '' };
  if (!from || !to || !validDateOverride(from) || !validDateOverride(to) || from > to) {
    return { error: 'Invalid date range' };
  }
  return { from, to };
}

function jobTimeDayKey_(value) {
  const date = jobTimeDate_(value);
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'America/Phoenix', 'yyyy-MM-dd');
}

function getJobTimeLog(actor, params) {
  if (!canViewJobTimeLog(actor)) return { error: 'forbidden' };
  const range = normalizeJobTimeRange_(params);
  if (range.error) return range;
  try {
    const rows = getJobTimeEntriesSheet_().getDataRange().getValues();
    const entries = rows.slice(1)
      .filter(row => row.some(value => value !== '' && value != null))
      .filter(row => {
        if (!range.from) return true;
        const day = jobTimeDayKey_(row[7]);
        return day >= range.from && day <= range.to;
      })
      .map(jobTimeLogEntryFromRow_)
      .reverse();
    return { success: true, entries };
  } catch (err) {
    console.error('Job time log failed for user %s: %s', actor.id, err && err.message);
    return { success: false, error: 'Could not load hours log' };
  }
}

function jobTimeExportFileName_(from, to) {
  return from === to
    ? 'hours-log-' + from + '.xlsx'
    : 'hours-log-' + from + '-to-' + to + '.xlsx';
}

function jobTimeExportSource_(source) {
  if (source === 'assigned') return 'Assigned';
  if (String(source || '').indexOf('costing_button:') === 0) return 'Costing button';
  return 'Other';
}

function jobTimeExportRows_(entries) {
  const headers = [
    'Employee', 'Department', 'Job Number', 'Job / Activity', 'Started', 'Ended',
    'Duration (Hours)', 'Status', 'Source', 'Notes', 'Last Edited', 'Edited By',
  ];
  const rows = (entries || []).map(entry => [
    sanitizeSheetText(entry.employee),
    sanitizeSheetText(entry.department),
    sanitizeSheetText(entry.jobNum),
    sanitizeSheetText(entry.jobName),
    jobTimeDate_(entry.startedAt) || '',
    jobTimeDate_(entry.endedAt) || '',
    Number.isFinite(entry.durationMinutes) ? Math.round((entry.durationMinutes / 60) * 100) / 100 : '',
    sanitizeSheetText(entry.status),
    jobTimeExportSource_(entry.source),
    sanitizeSheetText(entry.notes),
    jobTimeDate_(entry.editedAt) || '',
    sanitizeSheetText(entry.editedBy),
  ]);
  return [headers].concat(rows);
}

function exportJobTimeLog(actor, params) {
  if (!canViewJobTimeLog(actor)) return { error: 'forbidden' };
  const range = normalizeJobTimeRange_(params);
  if (range.error || !range.from) return { success: false, error: range.error || 'A date range is required' };
  const log = getJobTimeLog(actor, range);
  if (!log.success) return log;

  const name = jobTimeExportFileName_(range.from, range.to);
  let workbook = null;
  try {
    workbook = SpreadsheetApp.create(name.replace(/\.xlsx$/i, ''));
    workbook.setSpreadsheetTimeZone(Session.getScriptTimeZone() || 'America/Phoenix');
    const sheet = workbook.getSheets()[0];
    sheet.setName('Hours Log');
    const rows = jobTimeExportRows_(log.entries);
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, rows[0].length)
      .setFontWeight('bold')
      .setBackground('#173b70')
      .setFontColor('#ffffff');
    if (rows.length > 1) {
      sheet.getRange(2, 5, rows.length - 1, 2).setNumberFormat('m/d/yyyy h:mm AM/PM');
      sheet.getRange(2, 7, rows.length - 1, 1).setNumberFormat('0.00');
      sheet.getRange(2, 11, rows.length - 1, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
    }
    sheet.autoResizeColumns(1, rows[0].length);
    SpreadsheetApp.flush();

    const response = UrlFetchApp.fetch(
      'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(workbook.getId()) + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true },
    );
    if (response.getResponseCode() !== 200) throw new Error('Excel conversion failed');
    const blob = response.getBlob().setName(name);
    return {
      success: true,
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(blob.getBytes()),
    };
  } catch (err) {
    console.error('Export job time log failed for user %s: %s', actor.id, err && err.message);
    return { success: false, error: 'Could not export hours log' };
  } finally {
    if (workbook) {
      try {
        DriveApp.getFileById(workbook.getId()).setTrashed(true);
      } catch (cleanupError) {
        console.error('Could not remove temporary hours-log export: %s', cleanupError && cleanupError.message);
      }
    }
  }
}

function updateJobTimeNote(actor, data) {
  if (!canUseJobSelector(actor && actor.department)) return { error: 'forbidden' };
  const entryId = String((data && data.entryId) || '');
  const notes = String((data && data.notes) || '').trim().slice(0, 1000);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getJobTimeEntriesSheet_();
    const rows = sheet.getDataRange().getValues();
    const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[0] || '') === entryId);
    if (rowIndex === -1) return { success: false, error: 'Time entry not found' };
    if (String(rows[rowIndex][1] || '') !== String(actor.id || '')) return { error: 'forbidden' };
    sheet.getRange(rowIndex + 1, 12).setValue(sanitizeSheetText(notes));
    return { success: true, notes };
  } catch (err) { return { success: false, error: 'Could not save note' }; }
  finally { lock.releaseLock(); }
}

function updateJobTimeEntry(actor, data) {
  if (!canEditJobTimeLog(actor)) return { error: 'forbidden' };
  const entryId = String((data && data.entryId) || '');
  const jobNum = String((data && data.jobNum) || '').trim();
  const startedAt = jobTimeDate_(data && data.startedAt);
  const endedText = String((data && data.endedAt) || '').trim();
  const endedAt = endedText ? jobTimeDate_(endedText) : null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(entryId)) return { success: false, error: 'Invalid entry' };
  if (!startedAt) return { success: false, error: 'Valid start time is required' };
  if (endedText && !endedAt) return { success: false, error: 'Valid end time is required' };
  if (endedAt && endedAt.getTime() < startedAt.getTime()) return { success: false, error: 'End time must be after start time' };

  let resolvedJobName = '';
  let costingEntry = false;
  try {
    const initialRows = getJobTimeEntriesSheet_().getDataRange().getValues();
    const initialRow = initialRows.find((row, index) => index > 0 && String(row[0] || '') === entryId);
    if (!initialRow) return { success: false, error: 'Time entry not found' };
    costingEntry = String(initialRow[6] || '').indexOf('costing_button:') === 0;
    if (costingEntry) {
      if (jobNum) return { success: false, error: 'Costing activities do not use a job number' };
      resolvedJobName = String(initialRow[5] || '');
    } else if (!validJobKey(jobNum)) {
      return { success: false, error: 'Invalid job number' };
    } else if (String(initialRow[4] || '') === jobNum) {
      resolvedJobName = String(initialRow[5] || '');
    } else {
      const lookup = lookupSquarecoilJob_(jobNum);
      if (!lookup.success || !lookup.found || !lookup.job) {
        return { success: false, error: lookup.error || 'Job number was not found' };
      }
      resolvedJobName = String(lookup.job.name || '').trim();
    }
  } catch (err) {
    console.error('Resolve edited job number failed for user %s: %s', actor.id, err && err.message);
    return { success: false, error: 'Could not verify job number' };
  }
  if (!validText(resolvedJobName, 300)) return { success: false, error: 'Job name is required' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getJobTimeEntriesSheet_();
    const rows = sheet.getDataRange().getValues();
    const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[0] || '') === entryId);
    if (rowIndex === -1) return { success: false, error: 'Time entry not found' };
    const editedAt = jobTimeNow_();
    const legacyRow = rows[rowIndex].length <= JOB_TIME_BASE_HEADERS.length + JOB_TIME_AUDIT_HEADERS.length;
    const next = rows[rowIndex].slice(0, legacyRow ? 14 : JOB_TIME_HEADERS.length);
    while (next.length < JOB_TIME_HEADERS.length) next.push('');
    const elapsed = endedAt ? Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000) : null;
    const currentJobName = String(rows[rowIndex][4] || '') === jobNum
      ? String(rows[rowIndex][5] || resolvedJobName)
      : resolvedJobName;
    next[4] = costingEntry ? '' : jobNum;
    next[5] = sanitizeSheetText(currentJobName);
    next[7] = startedAt;
    next[8] = endedAt || '';
    next[9] = elapsed == null ? '' : Math.round(elapsed * 100) / 100;
    next[10] = endedAt ? 'closed' : 'active';
    next[legacyRow ? 11 : 12] = editedAt;
    next[legacyRow ? 12 : 13] = sanitizeSheetText(actor.name);
    next[legacyRow ? 13 : 14] = String(actor.id || '');
    sheet.getRange(rowIndex + 1, 1, 1, legacyRow ? 14 : JOB_TIME_HEADERS.length).setValues([next]);
    return { success: true, entry: jobTimeLogEntryFromRow_(next) };
  } catch (err) {
    console.error('Update job time entry failed for user %s: %s', actor.id, err && err.message);
    return { success: false, error: 'Could not update time entry' };
  } finally {
    lock.releaseLock();
  }
}

function deleteJobTimeEntry(actor, data) {
  if (!canEditJobTimeLog(actor)) return { error: 'forbidden' };
  const entryId = String((data && data.entryId) || '');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(entryId)) return { success: false, error: 'Invalid entry' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getJobTimeEntriesSheet_();
    const rows = sheet.getDataRange().getValues();
    const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[0] || '') === entryId);
    if (rowIndex === -1) return { success: false, error: 'Time entry not found' };
    sheet.deleteRow(rowIndex + 1);
    return { success: true };
  } catch (err) {
    console.error('Delete job time entry failed for user %s: %s', actor.id, err && err.message);
    return { success: false, error: 'Could not delete time entry' };
  } finally {
    lock.releaseLock();
  }
}

function activeJobTimeRows_(rows, userId) {
  const active = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1] || '') !== String(userId || '')) continue;
    if (String(rows[i][10] || '') === 'active' && !rows[i][8]) active.push({ rowIndex: i + 1, row: rows[i] });
  }
  return active;
}

function closeActiveJobTimeRows_(sheet, activeRows, endedAt) {
  activeRows.forEach(entry => {
    const startedAt = jobTimeDate_(entry.row[7]);
    const elapsed = startedAt ? Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000) : 0;
    const minutes = Math.round(elapsed * 100) / 100;
    sheet.getRange(entry.rowIndex, 9, 1, 3).setValues([[endedAt, minutes, 'closed']]);
  });
}

function resolveJobTimeSelection_(actor, data) {
  if (!canUseJobSelector(actor && actor.department)) return { error: 'forbidden' };
  const jobNum = String((data && data.jobNum) || '').trim();
  const source = String((data && data.source) || '');
  const costingButtonId = String((data && data.costingButtonId) || '').trim();
  if (source.indexOf('costing_button:') === 0) {
    const button = getCostingButtons().find(item => String(item.id) === costingButtonId);
    if (!button) return { error: 'Costing button is no longer available' };
    return { jobNum: '', jobName: String(button.text), source };
  }
  if (source === 'other_activity') {
    const jobName = String((data && data.jobName) || '').trim().slice(0, 300);
    if (!validText(jobName, 300)) return { error: 'Other activity is required' };
    return { jobNum: '', jobName, source };
  }
  if (!validJobKey(jobNum)) return { error: 'Invalid job number' };
  if (source !== 'assigned' && source !== 'other') return { error: 'Invalid job source' };

  if (source === 'other') {
    const result = lookupSquarecoilJob_(jobNum);
    if (!result.success || !result.found) return { error: result.error || 'Squarecoil job was not found' };
    return { jobNum, jobName: result.job.name, source };
  }

  // Assigned starts only need the tracking record to verify authorization.
  // Rebuilding the Calendar-backed production list here added seconds to the
  // shop-floor tap path even though the user had already loaded that list.
  const tracking = getAllTracking()[jobNum] || null;
  const openTasks = tracking && !tracking.completed && (tracking.departments || []).indexOf(actor.department) !== -1
    ? ((tracking.departmentChecklists && tracking.departmentChecklists[actor.department]) || []).filter(item => !item.done)
    : [];
  if (!tracking || !openTasks.length) return { error: 'This job no longer has open tasks for ' + actor.department };
  const jobName = String((data && data.jobName) || '').trim().slice(0, 300) || ('Job ' + jobNum);
  return { jobNum, jobName, source };
}

function getJobTimeStatus(actor) {
  if (!canUseJobSelector(actor && actor.department)) return { error: 'forbidden' };
  try {
    const rows = getJobTimeEntriesSheet_().getDataRange().getValues();
    const activeRows = activeJobTimeRows_(rows, actor.id);
    const active = activeRows.map(item => jobTimeEntryFromRow_(item.row));
    return { success: true, active: active.length ? active[active.length - 1] : null, activeEntries: active };
  } catch (err) {
    console.error('Job time status failed for user %s: %s', actor.id, err && err.message);
    return { success: false, error: 'Could not load current job' };
  }
}

function startJobTime(actor, data) {
  if (!canUseJobSelector(actor && actor.department)) return { error: 'forbidden' };
  const requested = Array.isArray(data && data.selections) && data.selections.length
    ? data.selections : [data];
  const selections = requested.map(item => resolveJobTimeSelection_(actor, item));
  const invalid = selections.find(item => item.error);
  if (invalid) return { success: false, error: invalid.error };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getJobTimeEntriesSheet_();
    const rows = sheet.getDataRange().getValues();
    const activeRows = activeJobTimeRows_(rows, actor.id);
    const startedAt = jobTimeNow_();
    // Legacy single-selection callers retain switch-job behavior.
    if (!(Array.isArray(data && data.selections) && data.selections.length)) {
      const selection = selections[0];
      const latest = activeRows.length ? activeRows[activeRows.length - 1] : null;
      const sameSelection = latest && (selection.source.indexOf('costing_button:') === 0
        ? String(latest.row[6] || '') === selection.source
        : String(latest.row[4] || '') === selection.jobNum);
      if (sameSelection) return { success: true, alreadyActive: true, active: jobTimeEntryFromRow_(latest.row) };
      closeActiveJobTimeRows_(sheet, activeRows, startedAt);
    }
    const existing = new Set(activeRows.map(item => `${item.row[4] || ''}|${item.row[6] || ''}`));
    const created = [];
    selections.forEach(selection => {
      const key = `${selection.jobNum}|${selection.source}`;
      if (existing.has(key)) return;
      const row = [Utilities.getUuid(), String(actor.id), sanitizeSheetText(actor.name), sanitizeSheetText(actor.department), selection.jobNum, sanitizeSheetText(selection.jobName), selection.source, startedAt, '', '', 'active', '', '', '', ''];
      sheet.appendRow(row);
      created.push(jobTimeEntryFromRow_(row));
    });
    const activeEntries = activeRows.map(item => jobTimeEntryFromRow_(item.row)).concat(created);
    return { success: true, alreadyActive: !created.length, active: activeEntries[activeEntries.length - 1] || null, activeEntries };
  } catch (err) {
    console.error('Start job time failed for user %s: %s\n%s', actor.id, err && err.message, err && err.stack);
    return { success: false, error: 'Could not start job — try again' };
  } finally {
    lock.releaseLock();
  }
}

function stopJobTime(actor) {
  if (!canUseJobSelector(actor && actor.department)) return { error: 'forbidden' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getJobTimeEntriesSheet_();
    const rows = sheet.getDataRange().getValues();
    const requestedEntryId = String((arguments[1] && arguments[1].entryId) || '').trim();
    const activeRows = activeJobTimeRows_(rows, actor.id)
      .filter(item => !requestedEntryId || String(item.row[0] || '') === requestedEntryId);
    if (!activeRows.length) return { success: true, stopped: false, active: null };
    closeActiveJobTimeRows_(sheet, activeRows, jobTimeNow_());
    return { success: true, stopped: true, active: null };
  } catch (err) {
    console.error('Stop job time failed for user %s: %s\n%s', actor.id, err && err.message, err && err.stack);
    return { success: false, error: 'Could not stop work — try again' };
  } finally {
    lock.releaseLock();
  }
}
