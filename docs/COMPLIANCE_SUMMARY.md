# GDPR and AI transparency implementation summary

This is an engineering record, not legal advice.

## Operating records and evidence (2026-11-06)

The [draft privacy operating pack](privacy/README.md) records the AI system, security measures, providers, processing activities, incident and rights procedures, backup/deletion limits, production acceptance and [commit-specific evidence](privacy/EVIDENCE_LEDGER.md). Named owners, retention periods, provider account settings and controller/legal decisions remain pending; these drafts are not a compliance certification.

Baseline main `df0d36f024a3fbcfa0b56b9127ebbcb9da7d79a6` passed [CI run 42031584583](https://github.com/Santonastaso/ment/actions/runs/42031584583), including Supabase migrations/deploy and production lint/RLS. Connected job metadata confirms success; no success artifact existed in that historical run. The revised CI retains allowlisted outcome artifacts for both success and failure, keyed to tested commit/run/attempt, for 30 days. Raw browser artifacts are no longer uploaded; CI traces are disabled and production lint/RLS output is suppressed. This evidence is engineering verification, not production privacy acceptance.

The latest known [retention run 42019067368](https://github.com/Santonastaso/ment/actions/runs/42019067368) on November 5 skipped its sweep; retention is not evidenced as operating. The candidate sprint requires Terms/Privacy acceptance to continue and narrows exports to own content/session metadata, excluding suggested-profile snapshots and other-author free text. Those changes require candidate-specific tests and deployment evidence. Required notice/Terms acceptance is separate from optional CV permission and does not establish a lawful basis by itself.

The technical review verified `RETENTION_ENABLED` is absent. The user confirms staging has not been set up: November 6 hosted AI [evaluation run 42201028926](https://github.com/Santonastaso/ment/actions/runs/42201028926) failed with `Missing staging eval configuration` before model calls, yielding no quality result. The [staging setup runbook](privacy/PRODUCTION_ACCEPTANCE.md#hosted-ai-evaluation-staging-setup-blocker) lists the separate project, approved dummy user and exact environment variables/secret required. Provider DPA signing status remains unknown.

## Implemented controls

- Organization-scoped access, row-level security, self-only private profile data, redacted peer profiles, and admin authorization.
- Single-use invitation tokens stored only as SHA-256 hashes, with expiry and revocation.
- Server-side AI credentials only. AI features fail closed when Mistral is disabled or unavailable; no fabricated fallback result is shown.
- AI prompts instruct the provider to use supplied facts only and avoid sensitive-trait inference.
- User review before AI-generated profile and outreach drafts are applied/sent. Reflection skill tags are automatically persisted; do not describe every AI output as manually approved.
- Calendar OAuth tokens are encrypted with AES-GCM before storage and are never readable by browser clients.
- Persisted audit events, private reflections/ratings, account deactivation, profile editing, and documented data-source provenance.
- Best-effort content-free AI run telemetry records successful and failed processing; it still contains user/organization IDs and is personal data. The admin view is limited by organization-scoped RLS. Edge rate-limit counters store only service-keyed HMAC digests and are inaccessible to member clients.
- Members can export their own account and activity data, withdraw future CV processing permission, and request account erasure. The candidate withdrawal endpoint removes CV drafts and private uploads, reports partial failure for retry, and uses database guards to prevent later uploads/drafts without fresh permission. Production verification is pending deployment.
- Organization admins can configure retention periods for conversations, searches, reflections, audit logs, inactive accounts, profile drafts, notifications, AI telemetry, outreach records, invitations, and meeting-benefit answers. No period is set by the migration. The daily sweep is gated by `RETENTION_ENABLED=true`; the workflow reports when it is disabled.

## Product transparency

- Matching and drafting are AI-assisted; the member chooses the person, edits the message, and sends it.
- AI output can be wrong and is not used for employment, admissions, grading, or automated access decisions.
- Capacity and existing-relationship rules are deterministic and enforced in the database, not decided by the model.

## Decisions still owned outside engineering

- Controller/processor roles, lawful basis, final retention schedule, data-subject request operating procedure, and production privacy wording.
- Approval and activation of each retention period, plus confirmation that the production sweep ran successfully.
- Mistral, Supabase, Google, Microsoft, email, and hosting DPAs/subprocessor review.
- Whether LinkedIn-derived data may be supplied by ESSEC and displayed to other members.
- Iubenda configuration and final legal approval.
- A documented incident-response owner and breach-notification process.

## Recommended evidence before launch

- Exported RLS/security test results, a completed DPIA screening, provider DPAs, deletion/export test, invitation abuse test, OAuth token rotation test, and a signed staging-import approval.
- A production check of CV withdrawal, the data export, and an enabled retention sweep after deployment.
