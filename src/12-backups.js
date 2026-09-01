// ── Backups ─────────────────────────────────────────────────────────────────
// The tracking spreadsheet holds every note, checklist, completion record and
// department assignment in the system, and its id exists only in Script
// Properties. Until this, there was no backup of any kind: deleting or
// corrupting that one file would have destroyed all production history with no
// recovery path. Jobs themselves would repopulate from Calendar; nothing else
// would.
//
// Hourly Drive copies meet the one-hour recovery-point target while remaining
// inexpensive against the consumer account's daily trigger budget. Copies live
// in their own folder so they can't be confused with the live sheet, and old
// ones are pruned so this can't grow without bound.
//
// By default these copies live in the script owner's account. For account-loss
// protection, BACKUP_FOLDER_ID can point at a folder owned by a second
// company-controlled account and shared with the script owner.
const BACKUP_FOLDER_NAME = 'SWS Prod Calendar - Tracking Backups';
const BACKUP_FOLDER_PROP = 'BACKUP_FOLDER_ID';
const BACKUP_INTERVAL_HOURS = 1;
const BACKUP_RETENTION_COUNT = 168; // seven days of hourly recovery points
const BACKUP_TRIGGER_HOURS_PROP = 'BACKUP_TRIGGER_HOURS';
const LAST_BACKUP_AT = 'LAST_BACKUP_AT';
const LAST_BACKUP_FILE_ID = 'LAST_BACKUP_FILE_ID';
const LAST_CONFIG_BACKUP_FILE_ID = 'LAST_CONFIG_BACKUP_FILE_ID';
const LAST_OPERATIONAL_FAILURE = 'LAST_OPERATIONAL_FAILURE';

function getBackupFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(BACKUP_FOLDER_PROP);
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (err) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty(BACKUP_FOLDER_PROP, folder.getId());
  return folder;
}

// Keeps the newest BACKUP_RETENTION_COUNT copies and trashes the rest. Sorts by
// the file's own creation date rather than parsing names, so a manually renamed
// or hand-made copy in this folder still ages out correctly.
function pruneOldBackups(folder) {
  const filesByKind = { tracking: [], configuration: [] };
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const kind = /^SWS Production Configuration /.test(f.getName()) ? 'configuration' : 'tracking';
    filesByKind[kind].push({ file: f, created: f.getDateCreated().getTime() });
  }
  const stale = [];
  Object.keys(filesByKind).forEach(kind => {
    filesByKind[kind].sort((a, b) => b.created - a.created);
    stale.push(...filesByKind[kind].slice(BACKUP_RETENTION_COUNT));
  });
  stale.forEach(entry => { try { entry.file.setTrashed(true); } catch (err) { /* already gone */ } });
  return stale.length;
}

function recordOperationalFailure(area, err) {
  const failure = {
    area: String(area || 'unknown'),
    at: new Date().toISOString(),
    message: String((err && err.message) || err || 'Unknown failure').slice(0, 500),
  };
  PropertiesService.getScriptProperties().setProperty(LAST_OPERATIONAL_FAILURE, JSON.stringify(failure));
  console.error('%s failed: %s', failure.area, failure.message);
  return failure;
}

function clearOperationalFailure(area) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(LAST_OPERATIONAL_FAILURE);
  if (!raw) return;
  try {
    const failure = JSON.parse(raw);
    if (!area || failure.area === area) props.deleteProperty(LAST_OPERATIONAL_FAILURE);
  } catch (err) {
    props.deleteProperty(LAST_OPERATIONAL_FAILURE);
  }
}

// Credentials are intentionally omitted. A disaster restore recreates the
// roster with temporary PINs that each user must replace, rather than copying
// hashes, Squarecoil credentials, or application secrets into Drive.
function configurationSnapshot() {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    users: getUsers().map(user => ({
      id: user.id,
      name: user.name,
      department: user.department,
    })),
    commonTasks: getCommonTasks(),
    costingButtons: getCostingButtons(),
    productionStatuses: getProductionStatuses(),
  };
}

function backupConfigurationSnapshot(folder, stamp) {
  const name = 'SWS Production Configuration ' + stamp + '.json';
  const blob = Utilities.newBlob(JSON.stringify(configurationSnapshot(), null, 2), 'application/json', name);
  return folder.createFile(blob);
}

// Runs hourly on a trigger (see setupAllTriggers). Safe to run by hand from
// the Apps Script editor to take an immediate backup.
function backupTrackingSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  try {
    const ss = getTrackingSpreadsheet();
    const folder = getBackupFolder();
    const now = new Date();
    const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const copy = DriveApp.getFileById(ss.getId()).makeCopy('SWS Production Tracking ' + stamp, folder);
    const configCopy = backupConfigurationSnapshot(folder, stamp);
    const pruned = pruneOldBackups(folder);
    props.setProperty(LAST_BACKUP_AT, now.toISOString());
    props.setProperty(LAST_BACKUP_FILE_ID, copy.getId());
    props.setProperty(LAST_CONFIG_BACKUP_FILE_ID, configCopy.getId());
    clearOperationalFailure('backup');
    Logger.log('Backed up tracking and configuration (pruned %s old file(s))', pruned);
    return { name: copy.getName(), id: copy.getId(), configId: configCopy.getId(), pruned };
  } catch (err) {
    recordOperationalFailure('backup', err);
    throw err;
  }
}

// Disaster-recovery tool: makes a new working copy so the retained backup is
// never edited in place, validates that it opens as a spreadsheet, then moves
// the live pointer. Run manually from the Apps Script editor after confirming
// the chosen backup file ID.
function restoreTrackingSpreadsheetFromBackup(backupFileId) {
  const id = String(backupFileId || '').trim();
  if (!id) throw new Error('Backup file ID is required');
  const source = DriveApp.getFileById(id);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const restored = source.makeCopy('SWS Production Tracking Restored ' + stamp);
  const ss = SpreadsheetApp.openById(restored.getId());
  if (!ss.getSheets().length) throw new Error('Backup has no sheets');
  PropertiesService.getScriptProperties().setProperty('TRACKING_SHEET_ID', restored.getId());
  PropertiesService.getScriptProperties().setProperty('LAST_RESTORE_AT', new Date().toISOString());
  return { id: restored.getId(), name: restored.getName() };
}

// Restores non-secret configuration and issues fresh alphabetical temporary
// PINs. The returned list is intended for the recovery operator's handoff; it
// is never exposed through the web API.
function restoreConfigurationFromBackup(backupFileId) {
  const id = String(backupFileId || '').trim();
  if (!id) throw new Error('Configuration backup file ID is required');
  const snapshot = JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.users)) {
    throw new Error('Unsupported configuration backup');
  }
  const restoredUsers = snapshot.users
    .filter(user => validName(String(user.name || '').trim()) && DEPARTMENTS.indexOf(user.department) !== -1)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((user, index) => {
      const pin = String(index + 1).padStart(6, '0');
      return withNewPin({
        id: /^[A-Za-z0-9_-]{1,100}$/.test(String(user.id || '')) ? user.id : Utilities.getUuid(),
        name: String(user.name).trim(),
        department: user.department,
        authVersion: 1,
        mustChangePin: true,
      }, pin);
    });
  if (!restoredUsers.length || !restoredUsers.some(user => user.department === 'Admin')) {
    throw new Error('Configuration backup must contain at least one Admin');
  }
  const tasksResult = saveCommonTasks({ department: 'Admin' }, { tasks: Array.isArray(snapshot.commonTasks) ? snapshot.commonTasks : [] });
  if (!tasksResult.success) throw new Error(tasksResult.error || 'Could not restore common tasks');
  const buttonsResult = saveCostingButtons(
    { department: 'Admin' },
    { buttons: Array.isArray(snapshot.costingButtons) ? snapshot.costingButtons : DEFAULT_COSTING_BUTTONS },
  );
  if (!buttonsResult.success) throw new Error(buttonsResult.error || 'Could not restore costing buttons');
  const statusesResult = saveProductionStatuses(
    { department: 'Admin' },
    { statuses: Array.isArray(snapshot.productionStatuses) ? snapshot.productionStatuses : DEFAULT_PRODUCTION_STATUSES },
  );
  if (!statusesResult.success) throw new Error(statusesResult.error || 'Could not restore production statuses');
  saveUsers(restoredUsers);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('TRAINING_PIN_BATCH', TRAINING_PIN_BATCH);
  props.setProperty('PIN_CHANGE_STATUS_BATCH', PIN_CHANGE_STATUS_BATCH);
  props.setProperty('LAST_RESTORE_AT', new Date().toISOString());
  return restoredUsers.map((user, index) => ({ name: user.name, pin: String(index + 1).padStart(6, '0') }));
}

function getSystemHealth() {
  const props = PropertiesService.getScriptProperties();
  const lastBackupAt = props.getProperty(LAST_BACKUP_AT) || '';
  const backupAgeMs = lastBackupAt ? Date.now() - new Date(lastBackupAt).getTime() : Infinity;
  const backupTriggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'backupTrackingSpreadsheet');
  let lastFailure = null;
  try { lastFailure = JSON.parse(props.getProperty(LAST_OPERATIONAL_FAILURE) || 'null'); } catch (err) { lastFailure = null; }
  return {
    checkedAt: new Date().toISOString(),
    healthy: backupAgeMs <= BACKUP_INTERVAL_HOURS * 2 * 3600 * 1000 && backupTriggers.length === 1 && !lastFailure,
    backup: {
      lastAt: lastBackupAt,
      current: backupAgeMs <= BACKUP_INTERVAL_HOURS * 2 * 3600 * 1000,
      triggerInstalled: backupTriggers.length === 1,
      recoveryPointHours: BACKUP_INTERVAL_HOURS,
    },
    trackingConfigured: !!props.getProperty('TRACKING_SHEET_ID'),
    squarecoilConnected: isSquarecoilConfigured_(),
    lastFailure,
  };
}
