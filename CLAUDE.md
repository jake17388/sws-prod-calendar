# Claude Code & Codex Configuration Guide

This project is configured to keep token usage low by splitting the monolithic Apps Script codebase (`Code.js`) into modular files.

## Project Architecture
*   **`src/`**: Contains the source files for the Google Apps Script backend. They are prefixed numerically to ensure they concatenate in the correct order:
    *   `01-config.js` - Server constants & initial configuration
    *   `02-users-roles.js` - User database, session rules, authorization levels
    *   `03-common-tasks.js` - Shared checklist phrases and costing configs
    *   `04-login-throttling.js` - Rate limiter for PIN login attempts
    *   `05-routing.js` - Web App API entrypoints (`doGet`/`doPost`) and route handlers
    *   `06-project-notes.js` - Shared timeline comments
    *   `07-calendar-jobs.js` - Google Calendar event loaders & parses
    *   `08-tracking.js` - Job progress checklist & completions
    *   `09-additional-files.js` - Private attachments and Drive storage
    *   `10-job-costing.js` - Time tracking log database & hours calculation
    *   `11-squarecoil-files.js` - Squarecoil login, session parsing & preloading
    *   `12-backups.js` - Backing up tracking sheets and system rosters
    *   `13-trigger-setup.js` - Scheduled task runners
*   **`Code.js`** (Root): **Generated File**. Do not edit this directly! It is ignored by Git, Claude, and Codex. It is compiled automatically from `src/` files before testing/deploying.

---

## Developer Commands

### Build Commands
*   **Build Apps Script Backend:** `npm run build:backend` (Compiles `src/*.js` into root `Code.js`)
*   **Build Frontend Pages:** `npm run build:pages` (Builds Jekyll static site to `_site/`)

### Test & Verification Commands
*   **Run All Verifications (Recommended):** `npm run check` (Runs backend build, check syntax, and runs tests)
*   **Syntax Check:** `npm run check:syntax`
*   **Unit & VM Tests:** `npm test`
*   **Coverage Report:** `npm run test:coverage`
*   **E2E (Playwright) Tests:** `npm run test:e2e`

### Clasp Deployment
When deploying backend changes:
1. Make your changes in `src/`.
2. Compile: `npm run build:backend`
3. Push: `clasp push`
4. Deploy (if needed): `clasp deploy -i <DEPLOYMENT_ID> -d "Description"`

---

## Code Guidelines
*   **Scope:** All files in `src/` run in the Apps Script global namespace. You can call functions and reference variables from other files directly without imports.
*   **Naming:** Use camelCase for variables/functions and UPPER_SNAKE_CASE for config constants.
*   **Permissions:** Always verify the active user's permissions in `src/02-users-roles.js` (e.g. `canEditDueDates`, `canManageDepartment`) before performing mutations.
