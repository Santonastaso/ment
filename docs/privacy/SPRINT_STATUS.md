# Privacy readiness sprint — 6 November 2026

User decisions: existing members must accept the current Terms and acknowledge the Privacy notice before protected screens load; self-service exports should be lean. Optional AI permission remains separate. Retention durations and operational owners have not been approved. The user confirms hosted staging does not exist and asks to finish code while leaving provider-console checks pending.

| Work item | Candidate implementation / evidence | Remaining gate |
| --- | --- | --- |
| Baseline | Main `df0d36f`, Vercel READY, successful Supabase release and access checks | Baseline evidence is in the ledger; it does not cover this candidate |
| Required existing-member review | Current document-version lookup, non-dismissible gate, sign-out alternative, retryable lookup/save failures; idempotent server records | Candidate CI and deployment; final legal text review |
| Full search history | Stable cursor pages include archived/active searches, reopen and delete; linked sessions/messages survive search deletion | Candidate CI and deployment |
| CV withdrawal | Permission/drafts revoked first; paginated upload cleanup; partial failure remains visible and retryable; upload/draft writes lock active consent | Candidate CI, real Storage and production race verification |
| Lean export and accurate help | Own search turns only; no structured suggested profiles, received request text, other-side private notes, meeting URLs or credentials; EN/FR/IT help corrected | Production download and native-language review |
| Verification evidence | Sanitized successful/failed CI summaries with source/tested commit and run identity; no raw browser uploads; manual synthetic acceptance runner | First candidate CI artifacts and deployed manual acceptance run |
| Synthetic AI quality | Deterministic tests present; hosted evaluation attempted and stopped before model calls due missing staging | Separate staging setup, then successful live evaluation and quality review |
| Provider review | Requested calendar scopes inventoried; public DPA links located; production Vercel revision verified | Signed-in account-setting evidence, contract/transfer review and named owner |
| Operating documents | Draft AI record, security measures, provider/processing registers, incident and rights procedures, backup limitations, acceptance/evidence ledger | Owner/controller review and assignment |
| Retention | Eleven configurable categories and gated sweep exist; switch currently absent | Approved durations, explicit activation and successful production run |
| Production acceptance | Manual workflow creates and erases only fresh marked synthetic fixtures, retaining sanitized results | Merge/release through existing production gate, then manual run; remaining UI/race checks in runbook |

This branch does not activate retention or change provider settings. Production still serves the baseline until the candidate is merged and released. No claim of completed GDPR/AI Act compliance is made by a successful build.
