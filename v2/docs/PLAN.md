# SWS Production Calendar v2 plan

Status: Milestone 0 in progress  
Working branch: `codex/v2`  
Principle: production v1 remains on `main` and operates independently until an explicitly approved cutover.

## Target architecture

An isolated staging frontend uses Firebase Authentication and Cloud Firestore. A separate staging Apps Script worker synchronizes only test Calendar, Drive, and fixture data. The target operating posture is Firebase Spark with no billable Cloud Run resources.

## Non-negotiable isolation controls

- Separate Firebase projects for development and production.
- Separate Apps Script project, calendars, Sheets, and Drive folders for v2 development.
- Mock Squarecoil first; later access is read-only and staging-only.
- Never store production resource IDs in development configuration.
- Reject production identifiers and production-like values in v2 development checks.
- Keep Firebase configuration environment-specific.
- Never deploy v2 automatically from `main`; staging deployment is manual.
- Maintain a synchronization-worker kill switch, disabled by default.

## Delivery method

Each milestone is a separate reviewable task: tests first, minimal implementation, focused verification, staging deployment where applicable, and a short acceptance report. Work does not advance until the milestone acceptance criteria pass.

## Milestone 0 — isolated v2 workspace

Goal: create a safe workspace without changing production.

1. Create `codex/v2` from current `main` in a separate worktree.
2. Add `v2/{web,firestore/{rules,indexes,seed},sync,shared,tests,docs}`.
3. Add symbolic environment templates.
4. Add a manually triggered staging workflow.
5. Fail CI when configured production identifiers appear under `v2/`.
6. Document environment boundaries and rollback.
7. Verify pushes to `codex/v2` cannot run production deploy workflows.
8. Verify existing v1 tests still pass.

Acceptance: production remains unchanged; v2 CI is independent; v2 contains no production IDs or credentials; staging requires explicit dispatch; v1 tests pass.

## Milestone 1 — contracts and baselines

Document existing models and versioned v2 contracts; create sanitized small-day, normal-week, busy-season, and large-history fixtures; measure cached render, fresh load, save, synchronization, PDF, and outage behavior; encode parity tests. Targets: cached screen under 1 second, fresh-data p95 under 2 seconds, write acknowledgement p95 under 750 ms, sync p95 under 2 seconds, and no indefinite loaders.

## Milestone 2 — Firestore model and rules

Model users, jobs and their notes/tasks, time entries, sync state, audit events, and system health. Add narrow indexes, role and department authorization, protected administrative fields, transactions, emulator configuration, authorization-matrix tests, and quota-conscious query tests.

## Milestone 3 — authentication

Use Firebase Authentication, preferably company Google accounts. Map identities to roles; support pending, disabled, and revoked states; require reauthentication for administration; provide complete session/error screens and staging-only test users. Do not store reusable PINs or application tokens in browsers.

## Milestone 4 — frontend shell

Build a visibly labeled `V2 STAGING` shell in the existing visual language. Add versioned assets, persistent Firestore cache, complete connectivity/data states, bounded operations, and one listener manager that closes hidden subscriptions. Validate offline use and listener stability on representative iPads and desktops.

## Milestone 5 — schedule and job synchronization

Render schedule/week/month from visible-range Firestore queries and active-job listeners. Implement completion and due-date writes with optimistic UI and transactional conflict recovery, preserve visibility rules, detect missed sequences, compare with sanitized v1 fixtures, and test concurrent browsers.

## Milestone 6 — operational writes

Migrate, in order: department assignment, checklists, notes, job completion, start/stop, time-entry notes/corrections, then hours export. For each, write emulator tests first, make retries idempotent, record audit events, test concurrency, and verify roles.

## Milestone 7 — Calendar worker

Create a separate staging Apps Script project reading test calendars. Normalize changed events into v2 jobs, retain last-good state, store cursors/fingerprints, prevent overlap, record metrics, expose manual sync first, and add a five-minute trigger only after verification. Browsers never call Calendar or Apps Script.

## Milestone 8 — Squarecoil worker

Build fixture-tested parsers covering failures and malformed data. After fixture stability, permit staging read-only access, fetch once per cycle, retain stale-valid snapshots, expose age/failures, back off on outages, and provide a kill switch. Browsers never call Squarecoil.

## Milestone 9 — files and PDFs

Keep Drive authoritative. Import each revision once, store metadata in Firestore, fetch only on open, cache immutable revisions, remove broad preloading, validate authorization/content/signature/size, and define expiration and disk-pressure behavior.

## Milestone 10 — operations and free-tier guardrails

Track health, sync duration, snapshot age, error categories, and daily usage. Warn at 60/75/90 percent, add staging smoke tests, test quota/service failures, create free-service backups and restoration procedures, and document incident/fallback/paid-upgrade thresholds.

## Milestone 11 — shadow comparison

Use a one-way production-source reader into an isolated shadow database without credentials, unnecessary personal data, or production writes. Compare counts and business fields daily for at least two normal work weeks, test shift concurrency, and run limited UAT.

## Milestone 12 — cutover

Create production Firebase resources, deploy tested rules/indexes, provision identities, migrate and verify checksums, briefly freeze v1 writes, perform final sync, deploy v2, smoke test, and reopen access. Keep v1 as a restricted fallback. Rollback redirects users to v1, stops v2 workers, preserves both stores, and reconciles post-cutover writes.

## Milestone 13 — stabilization and retirement

Operate v2 for one or two weeks, resolve discrepancies, confirm peak free-tier consumption, exercise restore, retain final v1 export, disable the old write endpoint and triggers, and preserve source/deployment instructions for audit and recovery.

## Principal risks

| Risk | Control |
| --- | --- |
| Accidental production writes | Separate projects, identifier denylist, one-way shadow mode |
| Firestore quota exhaustion | Narrow queries, managed listeners, usage thresholds |
| Long-lived branch drift | Small milestone commits and planned reconciliation from `main` |
| Rules expose department data | Emulator authorization matrix and denied-access E2E tests |
| Destructive source changes | Normalized snapshots, thresholds, and last-good retention |
| Cutover loses writes | Brief freeze, checksums, and reversible cutover |
| Slow Drive delivery | Lazy fetch, immutable cache, bounded storage |
| No free-tier SLA | Explicit fallback and billing-ready architecture |
