# GDPR and AI transparency implementation summary

This is an engineering record, not legal advice.

## Implemented controls

- Organization-scoped access, row-level security, self-only private profile data, redacted peer profiles, and admin authorization.
- Single-use invitation tokens stored only as SHA-256 hashes, with expiry and revocation.
- Server-side AI credentials only. AI features fail closed when Mistral is disabled or unavailable; no fabricated fallback result is shown.
- AI prompts instruct the provider to use supplied facts only and avoid sensitive-trait inference.
- User review before AI-generated profile drafts, skill suggestions, or outreach drafts are applied/sent.
- Calendar OAuth tokens are encrypted with AES-GCM before storage and are never readable by browser clients.
- Persisted audit events, private reflections/ratings, account deactivation, profile editing, and documented data-source provenance.
- Content-free AI run telemetry records successful and failed processing; the admin view is limited by organization-scoped RLS. Edge rate-limit counters store only service-keyed HMAC digests and are inaccessible to member clients.

## Product transparency

- Matching and drafting are AI-assisted; the member chooses the person, edits the message, and sends it.
- AI output can be wrong and is not used for employment, admissions, grading, or automated access decisions.
- Capacity and existing-relationship rules are deterministic and enforced in the database, not decided by the model.

## Decisions still owned outside engineering

- Controller/processor roles, lawful basis, final retention schedule, data-subject request operating procedure, and production privacy wording.
- Mistral, Supabase, Google, Microsoft, email, and hosting DPAs/subprocessor review.
- Whether LinkedIn-derived data may be supplied by ESSEC and displayed to other members.
- Iubenda configuration and final legal approval.
- A documented incident-response owner and breach-notification process.

## Recommended evidence before launch

- Exported RLS/security test results, a completed DPIA screening, provider DPAs, deletion/export test, invitation abuse test, OAuth token rotation test, and a signed staging-import approval.
