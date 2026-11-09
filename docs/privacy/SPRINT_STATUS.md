# Privacy readiness sprint — 9 November 2026

User decisions: existing members must accept the current Terms and acknowledge the Privacy notice before protected screens load; self-service exports should be lean. Optional AI permission remains separate. Retention durations and operational owners have not been approved. The user confirms hosted staging does not exist and asks to finish code while leaving provider-console checks pending.

| Work item | Implementation / evidence | Remaining gate |
| --- | --- | --- |
| Released sprint | Main `a9453c1`, Vercel READY, successful CI, Supabase release and verification evidence | Released 2026-11-09; evidence links are in the ledger |
| Required existing-member review | Current document-version lookup, non-dismissible gate, sign-out alternative, retryable lookup/save failures; idempotent server records | Released and CI-verified; final legal text review and a browser production spot-check remain |
| Full search history | Stable cursor pages include archived/active searches, reopen and delete; linked sessions/messages survive search deletion | Released and CI-verified; product spot-check remains |
| CV withdrawal | Permission/drafts revoked first; paginated upload cleanup; partial failure remains visible and retryable; upload/draft writes lock active consent; expanded synthetic runner races uploads against withdrawal and retries to a clean state | Earlier synthetic production acceptance passed; expanded main run pending after merge |
| Lean export and accurate help | Own search turns only; no structured suggested profiles, received request text, other-side private notes, meeting URLs or credentials; EN/FR/IT help corrected | Synthetic production acceptance passed; native-language review remains |
| Verification evidence | Sanitized successful/failed CI summaries with source/tested commit and run identity; no raw browser uploads; manual synthetic acceptance runner | Released main CI and production acceptance passed; durable archive owner/location remain |
| Synthetic AI quality | Deterministic tests present; hosted evaluation attempted and stopped before model calls due missing staging | Separate staging setup, then successful live evaluation and quality review |
| Provider review | Requested calendar scopes inventoried; public DPA links located; production Vercel revision verified | Signed-in account-setting evidence, contract/transfer review and named owner |
| Operating documents | Draft AI record, security measures, provider/processing registers, incident and rights procedures, backup limitations, acceptance/evidence ledger | Owner/controller review and assignment |
| Retention | Eleven configurable categories plus read-only report/apply separation, credential preflight, exact manual apply confirmation and kill switch | Production report passed: no periods/organizations configured, five stale uploads eligible, apply disabled. Approve periods and owner before any apply |
| Production acceptance | Workflow creates and erases only fresh marked synthetic fixtures; now covers deployed AI opt-out boundaries, concurrent CV withdrawal and completed/pending/scheduled erasure; browser fixture covers the Former member view | Earlier main attempt 2 passed its narrower scope; rerun expanded workflow after merge, then retain the sanitized evidence |
| Backup recovery | Local PostgreSQL dump/isolated restore proves pre-erasure data is resurrected and must be purged again; sanitized outcome only, outbound services disabled | Main recovery drill passed; select provider backup tier, verify database/Storage coverage, approve RPO/RTO and complete isolated provider restore drill |

The released sprint does not activate retention or change provider settings. This follow-up branch only hardens privacy-acceptance failure evidence and refreshes the records. No CI, deployment or acceptance result is a claim of completed GDPR/AI Act compliance.
