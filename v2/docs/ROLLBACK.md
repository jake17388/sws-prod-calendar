# V2 rollback policy

Before cutover, rollback means stopping v2 activity without touching v1:

1. Set the v2 worker kill switch to disabled.
2. Disable any v2 staging triggers.
3. Remove access to the staging frontend if necessary.
4. Preserve staging data and logs for diagnosis.
5. Continue using production v1 unchanged.

Never delete either datastore as part of incident response. After cutover, redirect users to restricted v1, stop v2 workers, preserve all v2 writes, and reconcile writes created after cutover before resuming either system.
