// ── Trigger setup ───────────────────────────────────────────────────────────
// One place that installs every time-driven trigger this script needs, so
// there's a single thing to run after a deploy that adds or changes one. Run
// from the Apps Script editor: Run > setupAllTriggers.
//
// Both are idempotent — running this repeatedly won't stack duplicate triggers.
function setupAllTriggers() {
  ensureSquarecoilRefreshTrigger();
  ensureBackupTrigger();
  const summary = ScriptApp.getProjectTriggers()
    .map(t => t.getHandlerFunction())
    .join(', ');
  Logger.log('Triggers installed: %s', summary);
  return summary;
}

// Normal app traffic self-heals the backup trigger at most once per hour, so
// a deploy never depends on someone remembering an Apps Script editor step.
// Failure is recorded for Admins but does not block the production calendar.
function ensureOperationalTriggersOnce() {
  const cache = CacheService.getScriptCache();
  if (cache.get('operational_triggers_checked')) return;
  try {
    ensureSquarecoilRefreshTrigger();
    ensureBackupTrigger();
    clearOperationalFailure('trigger-setup');
    cache.put('operational_triggers_checked', '1', 3600);
  } catch (err) {
    recordOperationalFailure('trigger-setup', err);
  }
}

function ensureBackupTrigger() {
  const props = PropertiesService.getScriptProperties();
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'backupTrackingSpreadsheet');
  const scheduledHours = +(props.getProperty(BACKUP_TRIGGER_HOURS_PROP) || 0);
  if (existing.length === 1 && scheduledHours === BACKUP_INTERVAL_HOURS) return;
  existing.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('backupTrackingSpreadsheet').timeBased().everyHours(BACKUP_INTERVAL_HOURS).create();
  props.setProperty(BACKUP_TRIGGER_HOURS_PROP, String(BACKUP_INTERVAL_HOURS));
  Logger.log('Tracking backup trigger set to every %s hour(s).', BACKUP_INTERVAL_HOURS);
}
