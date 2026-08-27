# Project delivery convention

For every user-requested application change in this repository, complete the full release workflow in the same task unless the user explicitly says not to deploy:

1. Implement and test the change.
2. Bump the application version and cache-busting asset versions as appropriate.
3. Commit the completed change.
4. Push the completed commit to `main`.
5. Confirm both the GitHub Pages and Apps Script deployment workflows succeed; investigate and fix failures before reporting completion.

Do not stop after a local commit and wait for a separate deployment prompt.
