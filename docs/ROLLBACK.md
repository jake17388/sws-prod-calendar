# Deployment rollback

Use this when a release fails its smoke test or breaks a production workflow.
Record the failed commit and the known-good commit before starting.

## GitHub Pages

1. Revert the bad commit with `git revert <bad-commit>`.
2. Push the revert to `main`.
3. Confirm the **Deploy to GitHub Pages** run succeeds.
4. Open the production URL in a private tab and verify login, job loading, and one safe read-only workflow.

## Apps Script

The live URL points to the non-`@HEAD` deployment ID. Rolling back requires
putting the known-good source back into the Apps Script project and creating a
new version on that same deployment.

```bash
git switch --detach <known-good-commit>
clasp push --force
clasp deployments
clasp deploy -i <non-HEAD-deployment-ID> -d "rollback to <known-good-commit>"
git switch main
```

Then confirm `clasp deployments` shows the rollback description and open the
Apps Script URL directly. It must return `SWS Production Calendar`. Verify PIN
login and job loading in the live frontend. If recovery is not complete within
two hours, activate the paper/Squarecoil fallback procedure.

After the incident, revert or repair the bad commit on `main`; otherwise the
next backend push will redeploy it.

## Data restore

The app keeps one hourly recovery point for the tracking spreadsheet and a
sanitized configuration snapshot. Seven days (168 hourly copies of each type)
are retained in the `SWS Prod Calendar - Tracking Backups` Drive folder. This
meets the business target of losing no more than one hour of production
updates. Configuration snapshots contain names, departments, and common task
phrases, but never PIN hashes, Squarecoil credentials, or application secrets.

For protection from losing the Apps Script owner's Google account, create a
Drive folder owned by a second company-controlled account, share it with the
script owner, and set the Apps Script property `BACKUP_FOLDER_ID` to that
folder's ID. Confirm the next hourly backup appears there before relying on it.

1. Open the backup folder and choose the newest healthy tracking copy created
   before the problem. Copy its Drive file ID.
2. In the Apps Script editor, run
   `restoreTrackingSpreadsheetFromBackup('<file-id>')`.
3. Refresh the production app and verify a known recent note, department task,
   and completion record.
4. If roster or common-task configuration was also lost, copy the matching JSON
   backup ID and run `restoreConfigurationFromBackup('<file-id>')`.
5. The configuration restore returns alphabetical temporary PINs. Distribute
   them privately; every restored user is forced to choose a new PIN.

The restore functions make new working copies and never modify the selected
backup. If restoration cannot be completed within two hours, use the documented
paper/Squarecoil fallback until the app is verified.

## Recovery drill

Run this drill quarterly and record the date, operator, chosen backup time,
restore duration, and result in the company operations notes:

1. Take an immediate backup by running `backupTrackingSpreadsheet()`.
2. Restore that copy with `restoreTrackingSpreadsheetFromBackup()`.
3. Confirm login, job loading, a recent note, department assignments, and a
   proof lookup.
4. Confirm Settings → System Health reports a current backup and installed
   trigger.
5. Restore the original tracking-sheet ID if the drill used production, or
   leave the verified restored copy live and record its ID.

Do not claim the two-hour recovery objective has been proven until a completed
drill is recorded. The paper/Squarecoil fallback remains the production process
during any drill or real outage.
