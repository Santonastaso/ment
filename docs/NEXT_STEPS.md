# Next steps — handover, 26 Sep 2026

Written after a day of UI/UX work on `main` (`7047a59` … `386b18f`). This lists
what is **blocked and why**, what was **found but not fixed**, and what the work
**revealed about the pipeline** that needs a decision rather than a commit.

Shipped work is in the git log and not repeated here.

---

## 1. Blocked on credentials or a decision — not on code

### 1.1 Notifications are produced but cannot be sent

Verified against production on 29 Sep. The plumbing is now built — what is
missing is two secrets and a decision about the backlog.

**Built and working:** `0048_session_notifications` enqueues session events, and
`.github/workflows/notification-outbox.yml` invokes the worker every 15 minutes.
`send-notification-outbox` resolves `profiles.notification_email` first, falling
back to the sign-in address.

**Blocking:** `RESEND_API_KEY` and `NOTIFICATION_FROM` are not set as Supabase
secrets. The worker cannot send, so nothing is delivered.

`public.notification_outbox` holds **195 rows, all `queued`** — up from 70 on
26 Sep. Nothing is `sent` and nothing is `failed`; a failing worker would leave
`failed` rows, so it is not running at all.

Two decisions before switching it on:

1. **The backlog sends at once.** Some rows are weeks old. A tester receiving a
   reminder about a meeting from May is a bad first impression. Decide whether to
   deliver, discard, or mark the pre-cutover rows as sent.
2. **`notification_email` is still unpopulated.** Until the pilot addresses are
   filled in, every one of those 195 goes to a placeholder login address — and to
   whoever owns those domains, if any are real. See 1.3.

### 1.2 Calendar sync, including Meet and Teams links

**The code is complete**, including the video links. `calendar-provider` asks
Google for a `hangoutsMeet` conference on event creation and reads back
`hangoutLink`; for Microsoft it sets `isOnlineMeeting` with
`onlineMeetingProvider: 'teamsForBusiness'` and reads `onlineMeeting.joinUrl`.
Either way the link is written to `sessions.meeting_url` and shown in the thread.

So Meet and Teams are not separate work — they come with the OAuth setup and
need nothing further once it is done.

**Blocking:** every credential is missing. Verified on 29 Sep — all six of
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` and
`CALENDAR_TOKEN_ENCRYPTION_KEY` are unset.

`OWNER_ACTIONS.md` §2 has the checklist: create the Google OAuth web app and the
Microsoft Entra app, register `https://YOUR_DOMAIN/calendar/callback`, approve
the scopes (`Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `User.Read`,
`offline_access`), then set the secrets.

Until then the UI says so plainly and points at the `.ics` download, which works
and carries the meeting into any calendar — just without a generated video link.

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

The same happened with two source files on 29 Sep — inter-org identity redaction
in `discovery-assistant` and a deactivated-account check in `requireUser` — both
live and uncommitted. Those have since been committed by their author.

**This is known and deliberate**: the CTO deploys directly. Recorded here only so
nobody reads `main` as the source of truth for what is live, and because of the
hazard below.

`supabase-functions.yml` deploys all ten functions on any push under
`supabase/functions/**`, and `npm run deploy:functions` deploys the same ten from
whatever is checked out. Either one, run against a `main` that is behind
production, silently reverts live code. Committing before deploying is the only
thing that prevents it.

As of 29 Sep the gap is closed: the deployed `discovery-assistant` is
byte-identical to `main`, and `db push --dry-run` reports the database up to
date.

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

Fixed in `386b18f`, and since confirmed working: a push on 29 Sep deployed
`discovery-assistant` automatically, and the deployed source now matches `main`
exactly. CI deploys on push, so no manual step is needed for function changes.

Still worth a look: whether anything committed to those five *before* the fix is
still not live. A download-and-diff of each against `main` would settle it.

### 3.4 `profiles` has column-level allowlists for both SELECT and UPDATE

From `0012`. A column added later is **invisible and unwritable until explicitly
granted**. `0046` added `notification_email` and it could be read by its owner but
not saved; `0047` supplies the grant.

Anyone adding a column to `profiles` needs to decide on both grants deliberately.
The default is deny, which is the right default — but it fails as a permission
error the client can only report as a generic failure.

---

## 3.5 Deferred on purpose: stricter discovery match prompt

Three prompt changes shipped on 29 Sep: drop "verified" from the draft wording,
and give the reflection and profile-ingest prompts a fixed skill-naming form.

A fourth was written, reviewed and **deliberately not applied**. It would have
tightened the `discovery_match` prompt so a candidate whose reason acknowledges
missing, indirect or adjacent evidence returns `no_match`, and replaced "return
at most three matches" with "one strong match is a better answer than three weak
ones".

**Held back because the platform is in UI/UX testing and testers need to see
matches.** With 125 members the stricter rule would return empty results
noticeably more often — correct, but it reads as a broken product to someone
evaluating the interface.

The two edits, for whenever it is picked up:

- after "False positives are worse than returning no match." add: *"If your
  reason for a candidate would need to acknowledge missing, indirect or adjacent
  evidence, the correct outcome for that candidate is no_match."*
- in the closing paragraph, require `matched_expertise` to be *"the specific
  evidence that satisfies the request, not merely a field copied from the
  profile"*, and replace the three-match allowance as above.

### Note: the code-side equivalent already shipped

`_shared/discovery-guards.mjs` now rejects any candidate whose reason matches a
weak-evidence pattern ("no direct", "adjacent", "may include", and the Italian
and French equivalents). That is the same intent as the held-back prompt change,
enforced in code rather than wording, and it is live.

So **matching is already stricter than it was during earlier UX testing**, and
the decision to hold the prompt back does not by itself keep results flowing. If
testers start seeing empty results, that guard — not the prompt — is the thing to
look at first. It is also the correct fix: the previous `hasGroundedExpertise`
only checked that the expertise string existed somewhere on the candidate, and a
candidate's own job title always does, so every candidate passed it.

---

## 4. Suggested order

1. **Notifications.** Producers and scheduling are built. What remains is
   `RESEND_API_KEY` and `NOTIFICATION_FROM`, the pilot addresses, and a decision
   on the 195 queued rows — see 1.1. Nothing else compounds like this.
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
