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
- **Authentication** is a 4-digit PIN, same pattern as `sws-job-map`
- **Hosted** on GitHub Pages — every push to `main` deploys automatically

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

Bump the version string in `version.json` on every deploy — the app fetches
it at boot and again on every tab-focus, and shows the "update available"
banner when it doesn't match what the page loaded with.

### Users & roles

Users live entirely in Script Properties as one `USERS` JSON array of
`{ id, name, department, pin }` records — never in git. Each user has a
department: `Admin`, `Production Manager`, `Viewer`, or one of the
production departments (`Manufacturing`, `Graphics`, `Paint`, `Assembly`,
`Letters`, `Routing`).

- **Admin** — full access, including managing every other account
- **Production Manager** — can add/edit/delete any account except Admin,
  Production Manager, or Viewer accounts (and can't see Admin/Viewer
  accounts in the list at all)
- **Viewer** and the production departments — no user-management access

Day to day, all of this is self-service: anyone in Admin or Production
Manager sees a "User Management" button in Settings, where accounts (name,
department, PIN) can be added, edited, or removed. There's no Apps Script
editor step for routine changes.

The one-time bootstrap is automatic: the first request after this feature's
initial deploy finds no `USERS` property yet, migrates the old flat `PINS`
map into it (Jake Banks becomes the sole Admin, everyone else comes in as a
Viewer), and everything after that goes through the app.

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
