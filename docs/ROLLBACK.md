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
