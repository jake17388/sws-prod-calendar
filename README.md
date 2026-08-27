# SWS Production Calendar

A web app for tracking production due dates — 2 business days before each
job's install start date — pulled from the `SWS - Install` and
`SWS - SUB Install` Google Calendars.

**Live app:** https://jake17388.github.io/sws-prod-calendar/

---

## How it works

- **Jobs** are pulled from the Install + SUB Install calendars via a Google
  Apps Script backend (`CalendarApp`, no OAuth consent screen needed)
- **Due date** = 2 business days before each job's install start date
  (multi-day jobs use the earliest day)
- **Completion/notes/checklist** are stored in a Google Sheet
  ("SWS Production Tracking"), created automatically on first use
- **Additional files** are stored privately in Google Drive, with their project,
  uploader, and timestamp recorded in the tracking sheet
- **Authentication** is a PIN-only account. Every PIN is exactly six digits and
  stored as a salted hash, with an Admin-visible copy for account support.
- **Hosted** on GitHub Pages — every push to `main` deploys automatically
- **System of record** remains Squarecoil. This app is an operational shop-floor
  coordination tool, not the authoritative retention or audit system.

---

## Making changes

- **Frontend** (`index.html`, `styles/`, `js/`): edit, commit, push to `main`
  — GitHub Pages redeploys in ~60 seconds
- **Backend** (`Code.js`, `appsscript.json`): edit, commit, push to `main`
  — CI runs `clasp push` + `clasp deploy`

---

## Config

### Backend — top of `Code.js`
```js
const INSTALL_CAL_ID = '...';
const SUB_INSTALL_CAL_ID = '...';
const CREW_NAMES = [...];         // canonical casing for installer names
const DEPARTMENTS = [...];        // full list of departments/roles — see "Users & roles" below
```

### Frontend — `js/config.js`
```js
export const SCRIPT_URL = '...'; // Apps Script /exec URL — update after each deploy
```

Bump the version string in `version.json` on every frontend deploy — the app fetches
it at boot and again on every tab-focus, and shows the "update available"
banner when it doesn't match what the page loaded with.

Every deploy that touches `js/` or `styles/` must also bump the matching
`?v=` query string on that file's `<script>`/`<link>` tag in `index.html`.
GitHub Pages' CDN caches those files for a while, so without a new query
string the "Update now" button can reload the page and still get stale JS
or CSS — the version bump forces a real fetch instead of a cached hit. The
button temporarily adds its own timestamp to the page URL as a final cache
buster; the freshly loaded app removes that timestamp from the address bar.

### Users & roles

Users live entirely in Script Properties as one `USERS` JSON array of records
containing an immutable ID, display name, department, hashed PIN credential,
an Admin-visible PIN copy, and session-revocation version — never in git. Each user has a
department: `Admin`, `Manager`, `Viewer`, `Costing Viewer`, or one of the production
departments (`Manufacturing`, `Graphics`, `Paint`, `Assembly`, `Letters`,
`Routing`).

- **Admin** — full access, including managing every other account, Squarecoil
  Production File refreshes, due-date overrides, and session revocation
- **Manager** — can add/edit/delete any account except Admin, Manager, Viewer,
  or Costing Viewer accounts (and can't see Admin/Viewer/Costing Viewer accounts in the list at all); can view the Hours Log without editing or deleting entries
- **Viewer** — calendar and project access with the normal project-note and additional-file capabilities, plus read-only Hours Log access, but no management permissions
- **Costing Viewer** — the same access and limitations as Viewer, plus permission to view the Hours Log; a pinned pencil action unlocks job number and timestamps for correction, while employee and resolved job name stay read-only. Corrections record the editor and timestamp, and deleting an entry requires confirmation
- **Production departments** — no user-management access

Day to day, all of this is self-service: anyone in Admin or Manager sees a
"User Management" button in Settings, where accounts (name, department,
PIN) can be added, edited, or removed. There's no Apps Script editor step
for routine changes.

Admins can view every current PIN in User Management. Managers can reset PINs
for production accounts they manage but cannot read them; only Admins can rename
accounts. Clicking a user's row opens account actions, including revoking all of
that user's sessions. Sessions expire after 12 hours, shared browsers sign out
after two hours without activity, and changing a PIN invalidates the account's
other sessions. Every role can change its own PIN under Settings → My Account.
New accounts and accounts still using the alphabetical training PIN are marked
`Temporary PIN` and cannot make production changes until they replace it.

The one-time bootstrap is automatic: the first request after this feature's
initial deploy finds no `USERS` property yet, migrates the old flat `PINS`
map into it (Jake Banks becomes the sole Admin, everyone else comes in as a
Viewer), and everything after that goes through the app.

---

## Multi-user sync

- **Live updates** — the client polls a cheap `getTrackingVersion` endpoint
  (one Script Property read, no Sheet/Calendar access) about every 30s while the
  tab is visible. When the counter has moved since the last full fetch, it
  re-fetches the job list. The counter itself bumps once inside
  `setTracking()` on every successful write, under the same `LockService`
  lock that serializes the write.
- **Optimistic concurrency** — every job carries an `updatedAt` stamp. Edits
  that replace a whole object built from a client-side snapshot (notes text,
  the full department checklist) send back the `updatedAt` they read; if it's
  since moved, the server rejects with `{ error: 'conflict' }` and returns
  its current state, which the client adopts instead of silently overwriting
  someone else's change. Single-field toggles (`toggleComplete`,
  `toggleDepartmentTaskDone`) skip this — they're applied to a fresh
  server-side read under the lock, so they can't clobber unrelated concurrent
  edits by construction.
- **Rapid interaction handling** — completion and department-task controls
  update immediately, briefly coalesce repeated taps, and show a local saving
  state while their final value is written. This keeps fast shop-floor input
  responsive without sending a burst of contradictory requests.

Every authenticated mutation carries a client request ID. The backend caches a
completed response briefly so a network retry does not repeat the operation.
The header shows `Saving…` while writes are in flight, and the browser warns
before closing a tab with unfinished writes.

Completing Paint's final open task automatically assigns the job to Assembly
and marks Assembly current. If Assembly has no open work, the app creates a
`Prep for Install` task attributed to the painter at the same completion time.

Completed jobs are collapsed under **Completed jobs** in Schedule view. The
normal app window includes calendar jobs from 14 days in the past through 90
days ahead, based on the install-calendar date (not the date the job was marked
complete). Leaving that window only removes a job from the app's normal views;
it does not delete its tracking record. Tracking history remains indefinitely
in the `SWS Production Tracking` Google Sheet unless an administrator removes
it manually. The **Archive** view searches completed history by job number,
saved title, note, department, or person and opens the retained project detail.
Production-department users only receive archived jobs assigned to their own
department. Older records created before archive snapshots were introduced
remain searchable by their job number and saved history. There is no automatic
purge.

The job screen uses the PDF on the newest Squarecoil DESIGN revision as the
**Production File**. Squarecoil credentials are stored only in Apps Script
Script Properties as `SQUARECOIL_USERNAME` and `SQUARECOIL_PASSWORD`. Active
jobs are refreshed into the shared Drive cache every six hours, with a live
lookup fallback for uncached jobs. Admins,
Managers, and Viewers can add up to 50 additional project files (8 MB each) by
choosing or dragging them into the project. Everyone who can view the project
can download those files and see who added each one and when. Only Admins can
delete them; that permission is enforced by the backend.

After each fresh job-list load, the browser preloads the complete original
Production Files for jobs due in the current and following
Sunday-through-Saturday weeks. After a short stagger, current-week downloads
run two at a time; following-week downloads begin only after those finish and
run one at a time. **View Production File** always opens the cached original in
the app's full-screen viewer. Files stay in browser disk cache for six hours,
while only an opened file is promoted into the small in-memory viewer cache.
Expired files are removed automatically so iPads do not retain an ever-growing
collection.

The PDF.js engine is pinned and served with the app rather than loaded from a
third-party CDN. Preloaded bytes are parsed before being accepted into cache;
temporary failures retry, and a bad cached copy is evicted and fetched again
automatically. The viewer renders page one immediately, lazily renders later
pages, and re-renders from the original vector PDF at each zoom level rather
than scaling a low-resolution preview.

## Validation and permissions

All permissions are enforced in `Code.js`; hidden frontend controls are only a
usability feature. Job keys, dates, departments, note/task lengths, request IDs,
and stored payload sizes are validated before writing. Production-department
accounts can only read jobs/Production Files assigned to their department and can only
change their own department tasks. Every authenticated role can add to the one
shared project-notes timeline; all viewers of that job see the same notes with
author names and timestamps. Note and checklist ownership uses immutable user
IDs rather than editable names.

## Tests and deployment safety

Run `npm run check` before pushing. It checks backend/frontend syntax and runs
the Node test suite. `npm run build:pages` creates `_site/`, the curated public
artifact; backend source and clasp configuration are never published.

Both deployment workflows run the checks before deployment and smoke-test the
live URL afterward. The Apps Script workflow also verifies that the live
deployment description contains the current commit. See
[`docs/ROLLBACK.md`](docs/ROLLBACK.md) for rollback steps.

The tracking spreadsheet and a sanitized roster/common-task snapshot are backed
up hourly with seven days of recovery points. Admins can verify the last backup,
trigger installation, and recorded runtime failures under Settings → System
Health. Normal app traffic self-heals a missing backup trigger.

---

## One-time setup (GitHub Actions secrets)

Settings → Secrets and variables → Actions:

- `CLASP_TOKEN` — contents of a `clasp login`'d `~/.clasprc.json`
- `CLASP_DEPLOYMENT_ID` — the Apps Script deployment ID from `clasp deploy`

---

## Calendars

| Calendar | ID |
|---|---|
| SWS - Install | `summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com` |
| SWS - SUB Install | `c_56442105e894ca5ed344bd94026279f754921d3ff42e0542c5d162f00c68ff07@group.calendar.google.com` |
