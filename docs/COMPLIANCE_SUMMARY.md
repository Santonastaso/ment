# GDPR and AI transparency implementation summary

This is an engineering record, not legal advice.

## Operating records and evidence (2026-11-09)

The [draft privacy operating pack](privacy/README.md) records the AI system, security measures, providers, processing activities, incident and rights procedures, backup/deletion limits, production acceptance and [commit-specific evidence](privacy/EVIDENCE_LEDGER.md). Named owners, retention periods, provider account settings and controller/legal decisions remain pending; these drafts are not a compliance certification.

Released main `a9453c1893d317b5750fbb5428207b9b14fdb10f` passed [CI/release run 42624769421](https://github.com/Santonastaso/ment/actions/runs/42624769421), including build/browser, database, Edge, secret scan, Supabase production release and verification evidence. Its Vercel production deployment reported READY. The CI retains allowlisted outcome artifacts keyed to tested commit/run/attempt for 30 days; raw browser artifacts are not uploaded, traces are disabled and production lint/RLS output is suppressed. This is engineering verification, not legal acceptance.

The guarded [synthetic production acceptance run 42649993249, attempt 2](https://github.com/Santonastaso/ment/actions/runs/42649993249) passed lean export, CV withdrawal/cleanup and retry, member/admin erasure, login closure, stale-token rejection, surviving-participant data and fixture cleanup. It did not test deployed AI, browser rendering, pending/scheduled-session erasure or the concurrent CV upload/withdrawal race. Required notice/Terms acceptance remains separate from optional CV permission and does not establish a lawful basis by itself.

The [read-only retention report 42651920105](https://github.com/Santonastaso/ment/actions/runs/42651920105) passed with no configured organizations/periods, zero eligible records in configured database categories and five stale uploads eligible. Apply was skipped and `RETENTION_ENABLED` remains disabled, so nothing was deleted. Retention is therefore safely reportable but not evidenced as operating in apply mode.

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
- Members can export their own account and activity data, withdraw future CV processing permission, and request account erasure. The released withdrawal endpoint removes CV drafts and private uploads, reports partial failure for retry, and uses database guards to prevent later uploads/drafts without fresh permission. The guarded synthetic production acceptance passed; provider erasure and concurrent-race coverage remain separate.
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
- Browser-level production spot-checks for Terms/Privacy, “Former member”, AI notices and language; a concurrent CV upload/withdrawal test; and an authorized retention apply only after periods and an owner are approved.
