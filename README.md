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
const DEFAULT_PINS = { '1234': 'Full Name', ... }; // real PINs live in Script Properties, not git — see setPins()
```

### Frontend — `js/config.js`
```js
export const SCRIPT_URL = '...'; // Apps Script /exec URL — update after each deploy
export const APP_VERSION = '...'; // bump on every deploy, checked against version.json
```

Also bump the version string in `version.json` to match `APP_VERSION` on
every deploy — that's what triggers the "update available" banner for
installed PWAs.

### Changing PINs

Real PINs are never committed. Paste the new set into `DEFAULT_PINS` in the
Apps Script editor, run `setPins()` once, then undo the edit locally so it
never lands in git — same workflow as `sws-job-map`.

### Squarecoil Scope of Work import

Squarecoil has no public API, so jobs' Scope of Work is fetched by logging
into `summitwestsigns.squarecoil.net` with a real session cookie and parsing
the project page's HTML. Credentials are never committed — from the Apps
Script editor, run once:

```js
setSquarecoilCredentials('username', 'password');
```

This scrapes `<textarea name="description">` on `project.php?id=<jobNum>`,
so it will break if Squarecoil changes that page's markup.

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
