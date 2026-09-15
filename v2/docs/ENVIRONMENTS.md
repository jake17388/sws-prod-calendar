# V2 environment boundaries

## Production v1

`main`, the existing Apps Script project, tracking sheet, calendars, Drive folders, public URL, and GitHub Pages site remain outside v2. V2 code must never write to or deploy these resources.

## Development and staging

- Work occurs only on `codex/v2` in its dedicated worktree.
- Every external resource is separately created and labeled for development or staging.
- Configuration starts from `v2/.env.example`; real environment files and identifiers are untracked.
- `SYNC_ENABLED=false` is the default kill switch.
- Squarecoil uses fixtures until a later milestone explicitly enables staging read-only access.
- `V2_FORBIDDEN_PRODUCTION_IDS` is a comma/newline-separated GitHub environment secret containing known production identifiers. CI scans all readable files under `v2/` for exact matches.

No Firebase or Apps Script project is created by Milestone 0. When staging resources are provisioned, keep Firebase on Spark and do not add billable Cloud Run services.

## Deployment boundary

Production workflows match `main` only. V2 CI matches `codex/v2`; the staging workflow has only `workflow_dispatch`, requires its boolean gate, and is attached to the `v2-staging` GitHub environment. Its actual deploy step remains intentionally absent until isolated staging resources exist.
