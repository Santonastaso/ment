# Next steps — handover, 26 Sep 2026

Written after a day of UI/UX work on `main` (`7047a59` … `386b18f`). This lists
what is **blocked and why**, what was **found but not fixed**, and what the work
**revealed about the pipeline** that needs a decision rather than a commit.

Shipped work is in the git log and not repeated here.

---

## 1. Blocked on credentials or a decision — not on code

### 1.1 Nothing can email anyone — highest impact

Two separate gaps, both verified against production on 26 Sep.

**Nothing drains the outbox.** `send-notification-outbox` exists, is correct, and
now resolves the right recipient — but nothing invokes it. `RESEND_API_KEY` is
unset, and no `pg_cron` job calls it. The six live jobs are `mt-expire-requests`,
`mt-nightly-rematch`, `mt-rate-limit-cleanup`, `mt-reflection-email-outbox`,
`mt-stale-matches`, `mt-weekly-checkin`; none of them sends.

`public.notification_outbox` currently holds **70 rows, all `queued`**. They
accumulate every Monday and are never delivered.

**Almost nothing fills it either.** The only producer in the schema is
`enqueue_reflection_email_reminders()`, the weekly reflection nudge. Session
requests, acceptances and meeting reminders **enqueue nothing at all**.

So wiring up the sender is necessary but not sufficient. An alumnus would still
not be told a student had asked for their time — that notification does not
exist yet and has to be written.

To do, in order: add producers for the session lifecycle (request received,
request accepted, meeting tomorrow); set `RESEND_API_KEY` and the sender domain;
add a `pg_cron` entry invoking the worker on a short interval; then drain or
discard the 70 stale rows before the first real send, since they are weeks old.

### 1.2 Calendar sync cannot work

`calendar-provider` throws `calendar_provider_not_configured` because the OAuth
apps do not exist. `docs/OWNER_ACTIONS.md` §2 has the full checklist: Google OAuth
web app, Microsoft Entra app, `https://YOUR_DOMAIN/calendar/callback`, scopes, then
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `MICROSOFT_*` /
`CALENDAR_TOKEN_ENCRYPTION_KEY` as Supabase secrets.

The UI now states this plainly and points at the `.ics` download, which works.

### 1.3 Pilot notification addresses are not populated

`profiles.notification_email` was added (`0046`) and granted (`0047`). Logins in
the pilot are placeholders, so **every row needs a real address before the mailer
is switched on**, or notifications go to mailboxes nobody reads — and to whoever
owns those domains, if any are real.

`admin-create-user` has no `notification_email` column, so the CSV import cannot
carry it. Either add it to the import, or set the 50 rows directly. The product
owner intends to do it manually in the backend.

This is personal data. `OWNER_ACTIONS.md` §3 and §5 already flag lawful basis and
member notice; separating login from contact makes that more visible, not less.

### 1.4 The app cannot be run locally

`client/.env.local` holds placeholder Supabase values, so sign-in fails and every
screen behind the auth guard is unreachable. It needs the project's real
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — both are public values already
shipped in the deployed bundle. Until then, local review means pointing at
production, which writes real rows.

---

## 2. Found and not fixed

Ordered by what a member would notice first.

| # | Issue | Where |
|---|---|---|
| 1 | Discovery merges an abandoned topic into a new one | `discovery-assistant` prompt |
| 2 | The same user message can render twice | `visibleTurns()` in `DiscoveryFlow.jsx` |
| 3 | Weak matches are padded out rather than returning none | `discovery-assistant` ranking |
| 4 | "Cancelled" is shown for requests nobody answered | `conversations.status.*` |
| 5 | Dashboard still duplicates Needs you / Scheduled | `Dashboard.jsx` |
| 6 | The skill cloud is flat and empty on day one | `SkillCloud.jsx` |
| 7 | Deleting a discovery thread uses `window.confirm()` | `DiscoveryFlow.jsx` |
| 8 | Recent searches sit behind an unlabelled clock icon | `DiscoveryFlow.jsx` |

**(1) is the most damaging.** Asked for a nurse, then asked about marketing,
Ment replied *"How can a nurse practitioner or doctor explain marketing concepts
to a layperson?"*. The prompt instructs the model to retain earlier details and
never says a later turn may *replace* the goal. This is the first ninety seconds
of the product for every student.

**(3)** returned a Brand Director in Marketing for a finance-and-consulting ask,
with the reason *"No direct consulting expertise, but adjacent executive roles may
include consulting experience"* — the system knew and showed it anyway. One honest
"nobody fits this yet" builds more trust than two padded results, and tells you
something true about directory coverage.

**(4)** is a rename, not logic: "Cancelled" implies someone decided. Requests do
expire on their own — `request_expires_at` defaults to seven days (`0038`) and
`mt-expire-requests` sweeps hourly — but the UI never mentions expiry and shows
the result as "Cancelled". A student cannot distinguish "considering it" from
"never saw it", and the alumnus looks rude for something a cron job did.

`discovery-assistant` is in the CI deploy list, so (1) and (3) ship on push.

---

## 3. Pipeline findings that need a decision

### 3.1 SQL is being applied directly to production

Two migrations existed in the database and in no commit:

| Version | Name | What it does |
|---|---|---|
| `20260925120000` | `0043_peer_linkedin_privacy` | Gates LinkedIn URL/headline behind an accepted connection or completed session |
| `20260926120000` | `0044_save_my_skills` | Transactional skill replacement: row lock, 80-char evidence cap enforced server-side, marks matches stale |

Both are recovered verbatim from `schema_migrations.statements` and committed.
The client calls both, so **a database rebuilt from this repo was missing a
privacy boundary and a skills RPC**.

The recovery is done; the cause is not. Someone has a workflow that writes to
production without committing, and it will recur.

### 3.2 A migration can be silently skipped

Supabase tracks migrations by **timestamp alone**, not name. A local file whose
timestamp matches an applied migration is treated as already applied:
`migration list` shows local and remote agreeing and `db push` reports "up to
date", while the SQL never runs and no error appears anywhere.

This happened. A language-normalization migration sat unapplied for a day behind
a timestamp collision with `0044_save_my_skills`, and the symptom — duplicated
entries in the Explorer language filter — was misread as already fixed.

Mitigation: always generate with `supabase migration new <name>`, which uses a
second-precision timestamp. A hand-written round timestamp is the hazard.

### 3.3 CI deployed five of ten edge functions

`.github/workflows/supabase-functions.yml` deployed five; `package.json`
`deploy:functions` lists ten. `admin-create-invitation`, `accept-invitation`,
`public-signup`, `send-notification-outbox` and `calendar-provider` were never
deployed by CI, so committed changes to them never reached production.

Fixed in `386b18f`. Worth checking whether anything was committed to those five
in the past and is still not live.

### 3.4 `profiles` has column-level allowlists for both SELECT and UPDATE

From `0012`. A column added later is **invisible and unwritable until explicitly
granted**. `0046` added `notification_email` and it could be read by its owner but
not saved; `0047` supplies the grant.

Anyone adding a column to `profiles` needs to decide on both grants deliberately.
The default is deny, which is the right default — but it fails as a permission
error the client can only report as a generic failure.

---

## 4. Suggested order

1. **Notifications, end to end.** Producers for the session lifecycle, then key,
   cron, sender domain and populated addresses. Nothing else compounds like this,
   and it is more work than it looks — see 1.1.
2. **Discovery prompt** — let a later turn replace the goal; return none rather
   than padding. Both ship through CI.
3. **Find out who is applying SQL directly to production** and route it through
   migrations.
4. `visibleTurns()` duplication, and rename "Cancelled" to what actually
   happened.
5. Calendar OAuth, when someone has an afternoon for provider consoles.
6. Retire the Dashboard session split, now duplicated by Messages.

---

## 5. Open questions for the CTO

- Do alumni need a **calendar view** of their meetings ("what does my week look
  like"), or is the thread list enough? If so it belongs as a List/Schedule toggle
  inside Messages, not another nav item.
- Should **declined/cancelled** threads leave the default inbox view? Six of
  eleven conversations on the test account are cancelled and they dominate `All`.
- Is `notification_email` expected to be **verified** before production, or does
  matching the login address make that moot?
- The skill cloud's **empty state** needs a decision: suggest skills from the
  member's program, show cohort-level data, or prompt differently on day one.
