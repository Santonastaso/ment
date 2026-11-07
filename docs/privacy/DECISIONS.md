# Decisions needed to operate the controls

## Retention periods

Every period is currently unset: the corresponding category is kept until a period is explicitly approved and the sweep runs. Values are whole days from 30 to 3650; no default is proposed by engineering. The controller should decide them based on the programme's purpose, academic cycles, obligations and exceptions. A single duration need not fit every category.

| Setting | What its current deletion clock measures |
| --- | --- |
| Conversations | Message creation time; closed-session free text uses last activity |
| Saved searches | Last update to the saved search |
| Reflections | Reflection creation time |
| Audit logs | Audit entry creation time |
| Deactivated accounts | Account deactivation time; applies account erasure |
| CV drafts | Draft creation time; raw CV text also has a separate 30-day expiry |
| Notifications | Creation time for sent/failed entries; queued entries remain |
| AI operation records | Telemetry creation time; contains identifiers but no prompt content |
| Outreach targets | Target record creation time |
| Invitations | Creation time, only once no longer pending or already expired |
| Meeting benefit answers | Answer creation time |

Example only: an approved search period of 365 days would remove a search whose last update is older than 365 days. It is not a recommended default. Backups, provider logs, delivered mail and external calendars have separate lifecycles and must be reviewed separately. Record the approver, date, scope and any exception before setting the values.

## People and responsibilities

- **Rights-request owner:** receives access/correction/export/deletion requests, verifies identity, coordinates with the university, tracks deadlines and records completion. Needs a deputy and an approved intake channel.
- **Incident coordinator:** receives security alerts, directs containment and evidence preservation, assesses impact with the privacy contact, and notifies the university promptly under the agreed procedure. Needs an out-of-hours escalation path and deputy.
- **Technical operator:** applies approved periods, monitors failed cleanup jobs, performs guarded retries and verifies deletion/restore behavior. This can be the technical owner but requires explicit assignment.
- **Controller/legal approver:** confirms the lawful basis, notice/Terms wording, contractual roles, durations, exceptions and provider/transfer decisions. Engineering does not supply that approval.

These roles may be shared by a small team, but the named primary, deputy, contact channel and escalation route must be recorded. Assignments remain pending; no external messages have been sent.
