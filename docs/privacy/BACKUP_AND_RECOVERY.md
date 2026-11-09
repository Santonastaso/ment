# Backup and recovery runbook — draft

Backup/recovery owner, approver, RPO and RTO: **PENDING named assignment and controller approval**. This runbook separates code-backed recovery controls from provider backup settings. It is not evidence that production backups exist or that a production restore has succeeded.

## Current evidence and limits

The repository has a `Synthetic backup recovery drill` workflow. It runs for pull requests and can be dispatched on `main` with the exact confirmation `RESTORE_SYNTHETIC_LOCAL_DATA_ONLY`. It starts a disposable local Supabase stack, creates one synthetic account, takes a PostgreSQL backup before erasure, erases the account, restores the older backup into a separate unexposed database, proves the restore resurrected the account, reapplies the erasure decision and verifies the Auth identity and personal rows are absent. AI, calendar and notification processing are explicitly disabled; the Edge runtime is not started. The workflow never reads GitHub environments or provider secrets and retains only allowlisted outcomes for 30 days.

That drill proves the purge-on-restore control can be rehearsed against the current schema. It does **not** prove Supabase scheduled-backup/PITR availability, backup encryption or expiry, Storage object coverage, regional placement, production restore permissions, recovery time or recovery point. Those remain pending provider-console evidence and a separate isolated project.

## Provider decisions and checks

Before relying on backups for launch, an authorized owner must:

1. Select and fund a Supabase tier or an approved independent encrypted backup mechanism. Do not infer coverage from database availability.
2. Record database backup frequency, retention/expiry, region, encryption and human/service access. Verify whether Supabase Storage objects are covered; if not, establish a separate encrypted object backup and expiry process.
3. Approve RPO and RTO with ESSEC. Record them as targets only after the architecture supports them and a drill measures them.
4. Create a restricted recovery project that cannot serve production traffic. Keep production custom domains, email, calendar, AI and webhook credentials absent.
5. Name the recovery operator and independent approver. Separate restore access from authorization to reopen traffic where practical.

## Isolated production-backup drill

Use synthetic/test accounts only until the controller approves a production-backup exercise. Never restore over production.

1. Record the source backup identifier, creation/expiry time, source region, expected scope and approved drill ticket in the restricted evidence system. Do not put member identifiers or backup contents in GitHub.
2. Provision a new isolated recovery project with no production DNS or client environment references. Keep `AI_PROCESSING_ENABLED`, `CALENDAR_SYNC_ENABLED`, `NOTIFICATIONS_ENABLED` and `RETENTION_ENABLED` false/absent. Do not install Resend, calendar, Mistral or production webhook credentials.
3. Restore database and, if covered, Storage into isolation. Restrict human and network access. Confirm the restored schema/commit and record start/end times for measured RPO/RTO evidence.
4. From the restricted rights-case system, reapply all completed erasure, restriction, consent-withdrawal and account-disable decisions newer than the backup. The repository does not yet provide or authorize that external ledger; its lawful basis, identifiers, retention and access must be approved before production use.
5. Verify with synthetic fixtures: erased users cannot authenticate; profile tombstones contain no personal fields; owned private uploads and personal rows are absent; surviving participants retain only allowed shared records; no outbound notification, calendar, AI or webhook action occurred.
6. Have the independent approver review the sanitized result. Destroy the recovery project and temporary exports under an approved schedule. Only a separate incident/recovery authorization may reconnect traffic or provider credentials.

## Evidence to retain

Keep a dated sanitized result containing source/deployed commit, workflow or ticket ID, backup class and age, database/Storage coverage, measured restore start/end, reapplication outcome, outbound-service checks, failures, approver and destruction confirmation. Keep raw backups, member identifiers and SQL output out of ordinary CI artifacts. The GitHub synthetic artifact is provisional and expires after 30 days.
