# V1 follow-ups

A running list of trade-offs and limitations that are acceptable for the MVP
demo but should be addressed in a proper V1. Each entry notes *what's wrong*
today, *why it's OK for now*, and a sketch of *what the V1 fix looks like*.

Add new items here whenever a "fine for MVP, fix later" decision is made.

---

## Sessions & meetings

### 1. Per-role completion state
**Status today.** A session has a single `status` column. The first side
(mentor or mentee) to click "Mark as completed" flips the whole session to
`completed`. After that, the other side no longer sees a Mark-complete prompt
on their dashboard — the session has left the *Needs your attention* lane.

**Why it's OK for MVP.** Whoever opens the app first does the marking. The
other side can still add a reflection ex-post from Past Meetings on Profile.

**V1 fix.** Track completion per role: `mentee_completed_at` and
`mentor_completed_at` on the sessions table. The session stays in *Needs your
attention* for whichever side hasn't marked it yet. Status `completed` is
derived (both sides marked) or kept simple as "either side marked".

---

### 2. Topics on legacy/seeded sessions are derived, not snapshotted
**Status today.** When a mentee picks topics in the session-request modal,
those are stored on `sessions.topics`. For sessions with no explicit topics
(legacy data, demo seeds with random pairings), we derive topics at view time
from the *current* `mentor.can_teach ∩ mentee.wants_to_learn`.

**Why it's OK for MVP.** Most demo sessions and all newly-requested ones have
explicit topics. The fallback works; it just drifts if either side edits
their skills after the fact.

**V1 fix.** When a session is requested with no explicit topics, snapshot the
overlap at request time so the historical record is stable.

---

### 3. ICS download, no real calendar integration
**Status today.** Confirmed-with-date sessions show an ICS download button.
No Google / Outlook / Apple Calendar OAuth.

**Why it's OK for MVP.** ICS works offline, has no third-party dependency,
no auth flow to build. Demo audiences understand it.

**V1 fix.** OAuth flows for Google Calendar and Microsoft Graph (Outlook).
Two-way sync would be ideal but a one-way write is the realistic V1 step.

---

## Notifications

### 4. Web Notifications API requires the tab open
**Status today.** Desktop toasts only fire when the app is in a focused
browser tab. Closing the tab silences notifications until the user reopens
the app.

**Why it's OK for MVP.** Demo audiences have the tab open. The admin's
*"Send reflection notes"* button delivers the toast within ~30s of the click.

**V1 fix.** Service Worker + Push API + a push provider (VAPID keys for
self-hosted, or Firebase Cloud Messaging). Allows real offline delivery for
the weekly check-in cadence.

---

### 5. Polling instead of push from server to client
**Status today.** Dashboard polls `/api/reflections` every 30s to check
`pending_checkin`. Cheap and simple but wastes calls 99% of the time.

**Why it's OK for MVP.** 300 users × 1 poll/30s = ~10 RPS at peak — fine for
a single-process node server.

**V1 fix.** Server-Sent Events stream from `/api/notifications/stream` so
the admin broadcast button delivers instantly. Drops the polling cadence.

---

## AI / classification

### 6. Claude path is wired but uncalibrated
**Status today.** When `ANTHROPIC_API_KEY` is set, the reflection classifier
sends candidates to Claude Haiku 4.5 first, then through ESCO. The prompt is
generic and lacks few-shot examples or user context (department, recent
session topics, existing skills).

**Why it's OK for MVP.** Claude is opt-in only. The default heuristic+ESCO
pipeline is what the demo uses.

**V1 fix.** Tighter system prompt with 3-5 few-shot examples covering edge
cases (tech jargon disambiguation, generic phrases like "All good", domain
context). Inject the user's existing `can_teach` / `wants_to_learn` to help
disambiguate ("React" as JS framework, not the verb).

---

### 7. ESCO labels can be over-long
**Status today.** ESCO returns labels like "perform financial risk
management in international trade" or "Python (computer programming)". The
acceptance rule trims the obvious overreach but some long labels still
appear in skill chips.

**Why it's OK for MVP.** Functionally correct, occasionally clunky.

**V1 fix.** Maintain a small alias table: when an ESCO label exceeds N words
or matches certain patterns, show a shortened display label while keeping the
full label + URI in the underlying record.

---

## Matching

### 8. Match feedback loop is dept-only
**Status today.** Viewer-specific score adjustments are based on per-
department accept/decline tallies. Skill-level feedback isn't captured.

**Why it's OK for MVP.** Department signal is enough to dampen obvious
mismatches and lift well-trodden paths.

**V1 fix.** Track per-skill accept/decline so a user who reliably accepts
"system design" mentors but declines "leadership" coaches gets ranked
accordingly.

---

### 9. Recompute-all on import / decline is O(n²)
**Status today.** `computeAllMatches` rebuilds every pair on admin upload
and on individual user changes. 300 users → 45k pair evaluations in 0.2s.

**Why it's OK for MVP.** Fast enough at this size.

**V1 fix.** Incremental updates — when one user's skills change, only
recompute pairs involving them. Background queue if the dataset grows.

---

## Manager / team

### 10. No UI to assign or reassign managers post-import
**Status today.** `manager_id` is set via CSV import (`manager_email` column).
There's no admin or self-service UI to fix it later.

**Why it's OK for MVP.** Org structure mostly comes from HR systems and is
imported once.

**V1 fix.** Admin user-detail view with an "edit manager" picker. Optionally
let the manager themselves confirm/decline reports.

---

### 11. Anonymized team report uses fixed `min_reports = 3`
**Status today.** Hard-coded threshold for showing the team skill-gap
report. Below 3 reports it's suppressed entirely.

**Why it's OK for MVP.** Conservative default, easy to explain.

**V1 fix.** Make it configurable per-org (HR policy) and add k-anonymity
guarantees for higher-stakes deployments — e.g. ensure no skill cell
identifies fewer than k people.

---

## Audit & privacy

### 12. Audit log grows forever; no retention or export
**Status today.** `audit_logs` table accumulates every event. No TTL, no
admin export to CSV/JSON.

**Why it's OK for MVP.** A few thousand rows even at heavy use.

**V1 fix.** Add retention policy (e.g. 365 days) with a daily prune job.
Add `GET /api/admin/audit/export` returning CSV.

---

### 13. No "right to be forgotten" flow
**Status today.** Deleting a user manually via SQL would cascade-delete
their skills, career history, and reflection logs (per `ON DELETE CASCADE`),
but sessions reference them as `mentor_id` / `mentee_id` without cascade.
There's no admin UI for offboarding.

**Why it's OK for MVP.** Internal tool, manual ops are acceptable.

**V1 fix.** Admin offboarding flow: anonymize sessions (replace name with
"Former colleague"), delete the user record, log the action.

---

## UI / accessibility

### 14. Hover-only popovers (skill landscape, ESCO chips)
**Status today.** Skill bubbles and ESCO chips show extra info only on
hover, which doesn't work on touch devices or for keyboard-only users.

**Why it's OK for MVP.** Most demo audiences use a desktop browser.

**V1 fix.** Click-to-open popovers + ARIA labels for screen readers.
Alternative non-color signal for the red→green skill landscape.

---

### 15. No internationalization
**Status today.** UI strings are hard-coded English. ESCO supports many
languages; we only request English.

**Why it's OK for MVP.** Single-language demo.

**V1 fix.** Extract strings to a JSON dictionary. Detect browser locale.
Pass `language=` to ESCO based on the user's preference.

---

### 16. No mobile-native or PWA install
**Status today.** Web only. Layouts are responsive, but no install banner,
no offline behavior, no push.

**Why it's OK for MVP.** Internal tool, desktop-first.

**V1 fix.** Add a `manifest.json` and basic Service Worker for "Install MENT"
behavior on mobile and desktop. No native app needed for V1.

---

## Data & ops

### 17. Bulk admin re-import skips existing users
**Status today.** Upload supports `?mode=insert|update|upsert` on
`POST /api/admin/upload`. Default `insert` skips existing emails; `update`
and `upsert` refresh department, role, seniority, tenure, location, and
skills for rows that already exist. No diff preview in the UI yet.

**Why it's OK for MVP.** Admins can re-import with `update` or `upsert` when
needed.

**V1 fix.** Add a mode toggle on the upload card and a diff preview
("3 new users, 12 fields changed across 8 existing users").

---

### 18. No HR analytics export
**Status today.** Admin dashboard shows aggregate stats but offers no CSV
download for the underlying data.

**Why it's OK for MVP.** Stats fit on one screen.

**V1 fix.** "Export anonymized analytics" button on the admin dashboard.

---

### 20. Reflection log fetches the last 50 entries with no pagination
**Status today.** `GET /api/reflections` returns up to 50 entries, hard cap.

**Why it's OK for MVP.** A user logging twice a week takes 6 months to hit
the cap.

**V1 fix.** Cursor-based pagination with `?before=<id>`.

---

## Closed (moved here when fixed)

### 19. Seed-large can't re-run on an existing DB
**Fixed.** `seed-large.js` runs `UPDATE users SET manager_id = NULL` before
`DELETE FROM users`, so re-seeding on an existing DB works without manually
removing the SQLite file.
