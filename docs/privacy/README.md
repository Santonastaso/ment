# Privacy operating pack — draft

Updated 2026-11-09 against released main `a9453c1893d317b5750fbb5428207b9b14fdb10f` and the dated production evidence in the ledger. This is an engineering and operating draft, not a compliance certification or legal approval. Source presence establishes implementation intent; only dated deployment and execution evidence establishes production behavior.

| Record | Purpose |
| --- | --- |
| [AI system record](AI_SYSTEM_RECORD.md) | Intended use, actual provider inputs, models, oversight and limitations |
| [Security measures](SECURITY_MEASURES.md) | Code-backed safeguards and operational gaps |
| [Provider inventory](PROVIDER_INVENTORY.md) | Verified source configuration versus unknown account settings |
| [Processing register](PROCESSING_REGISTER.md) | Draft purposes, subjects, recipients and retention decisions |
| [Incident response](INCIDENT_RESPONSE.md) | Draft response process and notification assessment |
| [Rights and deletion](RIGHTS_AND_DELETION.md) | Requests, exports, withdrawal and backup limitations |
| [Backup and recovery](BACKUP_AND_RECOVERY.md) | Synthetic purge-on-restore drill and provider restore runbook |
| [Production acceptance](PRODUCTION_ACCEPTANCE.md) | Concrete checks, evidence rules and unresolved acceptance items |
| [Evidence ledger](EVIDENCE_LEDGER.md) | Commit-specific historical and current verification |
| [Sprint status](SPRINT_STATUS.md) | Implemented work, verification and remaining gates |
| [Decisions](DECISIONS.md) | Retention clocks and operational responsibilities needing assignment |

All named operational owners, controller/processor allocation, retention periods, provider contracts, transfer assessments, legal bases and final notice wording remain **PENDING** unless a dated decision with a named approver is linked. Required acceptance of Terms/Privacy is a product access condition; it does not by itself establish a lawful basis or consent to optional CV/AI processing. The gate and lean export are released and covered by CI plus guarded synthetic production acceptance; the explicit browser/provider/race limitations remain in the runbook.

Evidence records contain commit/run/deployment identifiers, outcomes and counts only. Keep names, emails, member IDs, profiles, CVs, prompts containing member content, message text, tokens, credentials, raw responses and screenshots out of this pack and CI artifacts. Store request/incident case detail in a restricted system; reference only an opaque case identifier here.
