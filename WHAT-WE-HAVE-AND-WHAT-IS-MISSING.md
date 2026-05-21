# What we have and what is missing

A thorough snapshot of the MENT platform as of **2026-05-21**. Security,
tests, and seed sections below were refreshed against `main`; treat the
codebase as source of truth if anything drifts. Reads in two big parts:

1. **What we have** — every feature that's actually built, working, and
   shippable for the pilot.
2. **What is missing** — features that don't yet exist, gaps in coverage,
   and the V1-blocker items.

Companion: [V1-FOLLOWUPS.md](V1-FOLLOWUPS.md) tracks the 20 specific
"acceptable for MVP, fix for V1" trade-offs in more depth. This document is
the bird's-eye view; that one is the punch list.

---

## Part 1 — What we have

### 1.1 Authentication & accounts
- **Email + password login** with bcrypt-hashed passwords.
- **JWT-based session** issued on login; carried as a bearer token by the
  client on every API call.
- **Self-registration** endpoint exists but the demo flow seeds users via
  CSV import or `npm run seed`. Seeded/imported users get a one-time random
  temp password and `must_change_password=1` until they rotate it on first login.
- **Admin flag** on the user record gates the `/admin` routes and the
  Admin tab in the navbar.

### 1.2 Onboarding
- **3-step wizard** at `/onboarding`:
  1. Background (name, department, current role, location, bio, career
     history with month/year)
  2. What you can teach (skills + optional example projects per skill)
  3. What you want to learn + optional day-shadow open-ended response
- **Month/year picker** (custom dropdown component) for unambiguous date
  entry on career rows.
- **Progress indicator** (3 dots) and Back/Continue navigation.
- `onboarding_complete` flag set on the user record at finish.

### 1.3 User profile
- **View own profile and view other users' profiles** (read-only when not
  the owner).
- **Editable fields** for the owner: name, department, current role,
  location, bio. Partial PUT — only changed fields are sent.
- **Career history** with full CRUD (add, **edit**, remove). Month/year
  picker keeps date format unambiguous. Renders periods as e.g.
  `Jun 2018 – Jul 2022` or `2018 – present`.
- **Skill landscape** — visual bubble chart of every skill the user has
  (can_teach + wants_to_learn), with per-skill progress reflecting sessions
  delivered. Click-to-remove from the bubble itself when on own profile.
- **Expertise signature** — the top can_teach skills that colleagues seek
  this person out for.
- **Manage skills panel** — TeachSkillsEditor (skill + example project per
  row), wants-to-learn tag input. Skill changes hit the server immediately.
- **Past meetings** — list of completed sessions with rating + reflection
  editor; only the viewer's own reflection/rating is visible (cross-role
  privacy enforced server-side).
- **Reflection log** — weekly check-in component (see 1.7 for details).
- **Day-shadow response** — single-question reflective field, fully private
  to the user, used by matching to surface unexpected pairings.
- **Badges** display when applicable.

### 1.4 Dashboard
- **Top match cards** — three primary "Mentors for you" matches plus a
  separate Explorer view. Each card shows affinity dots, top reasons, and
  has Connect / Decline actions.
- **Affinity indicator** — 5-dot navy-on-slate indicator with tier label,
  calibrated against the ~85 max score the algorithm actually produces.
- **Upcoming meetings** — confirmed sessions sorted by date; reschedule +
  cancel + ICS-download actions.
- **Needs your attention** — pending invitations + past-scheduled sessions
  awaiting completion.
- **Pending check-in toast** — when admin broadcasts the weekly reflection
  nudge, the dashboard polls and surfaces it.

### 1.5 Matching algorithm ([server/utils/matching.js](server/utils/matching.js))
- **Three base signals**:
  - Skill overlap (mentor.can_teach ∩ mentee.wants_to_learn)
  - Career bridge (mentor has previously held mentee's current role)
  - Department diversity (different departments score higher to encourage
    cross-functional pairing)
- **Viewer-specific adjustments stacked on top**:
  - Per-department accept boost: +2 per accepted session, cap +6
  - Per-department decline penalty: -1 per decline, cap -8
  - Per-department rating bias: range ±5, activates at n≥2 ratings to avoid
    single-data-point swings
- **Reasons** — every score comes with rationale strings that render in the
  MatchCard "Why this match?" panel.
- **Mentor-leaning filter** — Dashboard's "Mentors for you" view skews to
  users where the viewer is on the receiving end of expertise.
- **Recomputation** — all pairs recompute on admin upload and on individual
  user changes (O(n²) — fast enough at MVP scale; see V1 item 9).

### 1.6 Connections & match feedback
- **Connect / Decline** from MatchCard upserts a `connections` row. The
  decline signal feeds back into future scoring via the per-dept penalty.
- **Audit log** records each accept/decline.

### 1.7 Reflection log (weekly check-in)
- **Two-prompt form**: *what support did you need?* + *what did you handle
  well?*
- **AI classification on submit**:
  - If `ANTHROPIC_API_KEY` is set: Claude Haiku 4.5 reads the text first.
  - Then everything goes through the **ESCO** public skill taxonomy for
    canonicalization.
  - Fallback heuristic if both fail.
- **Extracted gaps and strengths** appear as chips below the entry.
- **Per-chip dismiss** before applying (click `×` to drop a suggestion).
- **One-click apply** — kept chips become `wants_to_learn` (gaps) and
  `can_teach` (strengths) rows on the user's skill set. Duplicates are
  skipped server-side.
- **Source attribution** — each entry shows whether classification came
  from Claude+ESCO, ESCO alone, or heuristic fallback.
- **Strictly private** — only the writing user can read their reflections;
  the server enforces this on every query.

### 1.8 Sessions / meetings
- **Request a session** from another user's profile via a modal that lets
  the mentee specify topic, pre-session question, proposed datetime,
  duration.
- **Lifecycle states**: `pending` → `scheduled` / `declined`; scheduled →
  `completed` / `cancelled` / (`rescheduled` writes a new state but keeps
  history).
- **Topics on request** are stored on the session itself (snapshotted at
  request time when present; derived from current skill overlap when
  legacy/seeded sessions have none).
- **Per-role completion** — `mentor_completed_at` and `mentee_completed_at`;
  each side marks complete independently after the scheduled time has passed.
- **Per-side reflection** — mentor_reflection and reflection (mentee)
  columns. Each side sees only their own.
- **Per-side rating** — 5-star RatingPicker with hover hints. mentor_rating
  and mentee_rating columns. Each side only sees their own; the rating
  feeds the matching algorithm.
- **Reschedule / cancel** actions with audit log entries.
- **ICS download** — confirmed-with-date sessions can be added to any
  calendar app via downloaded `.ics` file.
- **Cross-role privacy** — reflections, ratings, and pre-session questions
  are filtered server-side in `enrichSession()` based on `req.user.id`'s
  role.

### 1.9 Explorer
- Separate page at `/explorer` for browsing matches beyond the top three on
  the dashboard. Lighter-weight list view.

### 1.10 Team skill-gaps view
- **Manager-only page** at `/team-skills` aggregating direct reports'
  `wants_to_learn` skills.
- **k-anonymity threshold** — fixed `min_reports = 3` per skill (skills
  with fewer than 3 reporters are suppressed entirely).
- Endpoint: `GET /api/team/skill-gaps`.

### 1.11 Admin dashboard
- **Stats** — counts of users, sessions, matches, reflections, audit
  events.
- **CSV/XLSX upload** — bulk-import users with email, name, department, role,
  manager_email columns. Query param `?mode=insert|update|upsert` (default
  `insert` skips existing; `update`/`upsert` refresh profile fields).
- **Template download** — get the CSV header row as a starter file.
- **Rematch all** — manual trigger to recompute every pair.
- **Broadcast check-in** — sets `pending_checkin=1` on every user;
  dashboards surface the prompt on next poll.
- **Audit log viewer** — paginated list of every recorded event with actor,
  action, target.

### 1.12 Skill data infrastructure
- **ESCO public REST API integration** for canonicalizing free-text skills
  to the European Skills/Competences/Qualifications/Occupations taxonomy.
- **`esco_uris` JSON column** on reflection_logs preserves the canonical
  URI per extracted skill.
- **Optional Claude Haiku 4.5** path for richer extraction; falls back
  gracefully when no API key is configured.

### 1.13 Audit log
- **Append-only `audit_logs` table** with actor, action, target type+id,
  metadata, IP, timestamp.
- **Event types recorded**: `auth.login`, `session.accept`, `session.complete`,
  `session.cancel`, `session.reschedule`, `session.reflection_added`,
  `session.rated`, `reflection.apply`, plus admin operations.

### 1.14 Database & migrations
- **SQLite via better-sqlite3** in WAL mode — single-file, fast,
  zero-config.
- **8 tables**: users, career_history, skills, connections, sessions,
  match_scores, audit_logs, reflection_logs.
- **Idempotent migrations** — `ALTER TABLE … ADD COLUMN` calls wrapped in
  try/catch on duplicate-column error, run on every server boot.
- **Foreign keys ON** with `ON DELETE CASCADE` on dependent rows where
  appropriate (skills, career_history, reflection_logs).

### 1.15 Tooling & developer setup
- **Vite + React** frontend with HMR.
- **Express + Node `--watch`** backend with auto-reload.
- **Tailwind CSS** with a custom navy/slate/gold trust palette in
  [client/tailwind.config.js](client/tailwind.config.js).
- **Seeding scripts** — `npm run seed` (~15 users) and
  `npm run seed:large` (~300 users with realistic skill distributions).
- **Jest tests** — matching, session privacy, reflection apply, auth gate,
  profile ingest (`npm test` in `server/`).
- **Single-process deployment** path: `vite build` → `client/dist/`,
  Express serves the static bundle when `NODE_ENV=production`.

### 1.16 Pilot kit (non-software assets, in repo)
- **8 markdown files** in `pilot-kit/`: 5 email templates (SME pitch,
  employee onboarding, match suggestion, full intro, post-session
  reflection), landing copy, employee FAQ, co-founder conversation guide,
  one-pager.
- **7 Airtable-import CSVs** in `airtable-csvs/`: companies, employees,
  sme-admin-contacts, skill-catalog, matches, sessions, reflections —
  templated so the cross-company manual concierge phase can run on Airtable
  before software is needed.

### 1.17 Git & version control
- **Private GitHub repo**: `Frament-ag/Project_1`.
- `.env` files, `*.db*` files, and `node_modules` are gitignored.
- Two commits on main as of this writing: initial commit + the career-edit
  / month-picker / rating-weighted-matching / UI polish bundle.

---

## Part 2 — What is missing

Categorized by impact. **Bold = blocking** (must address before any
production-like exposure). Plain = nice-to-have for V1. *Italic = research
or product question, not yet a build task.*

### 2.1 Security & production-readiness — BLOCKING for any non-demo exposure

**Done (POC floor):** `JWT_SECRET` required at boot (no fallback), helmet,
auth rate limiting (`/api/auth`), forced password rotation for imported/seeded
users, configurable `CORS_ORIGINS`.

**Still missing:**
- **No HTTPS-enforcement** layer in the Express app (assumes reverse proxy
  handles TLS).
- **No password complexity rules** beyond bcrypt hashing the input.
- **No 2FA / SSO**. SAML or OAuth for SMEs that already use Google
  Workspace / Microsoft 365 would be a strong asset.
- **CORS allowlist** is `localhost:3000` only (acceptable for dev; needs
  prod origins on deployment).
- **No CSP beyond helmet defaults, no explicit HSTS** (assumes reverse proxy).
- **No email verification** on registration.
- **No password reset flow** (no email infrastructure wired up at all).
- **No session revocation** — JWTs are stateless and live until expiry; no
  blocklist for compromised tokens.

### 2.2 Multi-tenancy — BLOCKING for cross-company SaaS pivot
The codebase assumes a **single organization**. No `organization_id`
column on any table. The cross-company SME peer-mentoring concept the
business plan now centers on cannot be served by the current schema. This
is the single biggest architectural gap between the current MVP and the
direction described in the pilot kit.

To support it, V1 needs:
- An `organizations` table.
- `organization_id` foreign key on users, sessions, skills, reflections,
  audit_logs.
- Row-level access enforcement on every query.
- Cross-org match opt-in (mentor explicitly allows external mentees;
  default off).
- Per-org admin role separate from platform admin.

### 2.3 Notifications & engagement
- **No email sending infrastructure**. Match suggestions, session
  invitations, weekly check-in nudges, and reflection prompts all rely on
  the user being in the app. The pilot-kit email templates exist as
  *content* but are not wired to send.
- **No SMS or push**. Dashboard notifications fire only when the tab is
  open and focused.
- **Polling-based delivery** for the broadcast check-in (30s cadence) —
  works but wasteful (V1 item 5).
- **No Service Worker, no PWA install** (V1 item 4 + 16).

### 2.4 Calendar integration
- **ICS download only** — no Google / Outlook / Apple Calendar OAuth.
- **No availability picker** — mentees propose a time blindly. The mentor
  cannot publish "I'm available Tues/Thurs afternoons" upfront.
- **No timezone handling beyond raw datetime strings** — both parties have
  to figure out the timezone for the scheduled_at field themselves. (V1
  item 3.)

### 2.5 Video / actual meeting layer
- **No built-in video calling, no Zoom/Meet/Teams deep links**. The
  product currently helps people *find* each other and *schedule*; the
  actual meeting happens out-of-band. For pilot phase that's fine; for V1
  most SMEs will want either deep links or generated meeting URLs.

### 2.6 Onboarding & retention
- **No re-engagement campaigns** (e.g. "you haven't logged in in 30 days"
  emails).
- **No empty-state onboarding nudges** beyond the initial wizard.
- **No "5 things to do in your first week"** progressive checklist.
- **No referral or invite-a-colleague flow**.

### 2.7 Matching — known limitations
- **Dept-only feedback signal**, not skill-level (V1 item 8).
- **No "snooze a mentor" mid-term** — only Connect or Decline.
- **No explicit ratings of the *recommendation* itself** separate from
  rating the actual mentor — we infer one from the other.
- **No diversity / promotion equity guardrails** — e.g. ensuring junior
  women receive surfacing for cross-functional mentors. Worth considering
  before broad rollout.
- **No learning-objective tracking** — wants_to_learn is flat; no
  goal-setting or progress milestones.

### 2.8 AI / classification
- **Claude prompt is generic** — no few-shot examples, no user-context
  injection (V1 item 6).
- **ESCO labels can be over-long** — chips occasionally read clunky (V1
  item 7).
- **No "propose a brand-new skill that ESCO doesn't have"** UI flow.
  Reflection chips are bounded by what the classifier already recognizes;
  niche or company-specific skills slip through.
- **No moderation step** — applied skills feed the team aggregate
  immediately; a manager-side review queue would harden the flow.
- **No multi-language reflection** — ESCO supports many languages, the
  product asks in English only.

### 2.9 Team / manager experience
- **Single read-only team view** (skill-gaps aggregate). No:
  - Direct-reports list with last-session timestamps.
  - "Suggest a mentor for [report]" prompt.
  - Manager 1:1 reflection capture.
  - Manager-visible KPI dashboard (cadence, satisfaction trends).
  - Ability to assign / reassign reports (V1 item 10).
- **No skip-level visibility**, no department head rollup.

### 2.10 Admin / HR
- **No CSV export** of analytics (V1 item 18).
- **No audit log export or retention policy** (V1 item 12).
- **No diff preview on CSV re-import** — `?mode=update|upsert` exists; UI toggle still open (V1 item 17).
- **No user offboarding flow** (V1 item 13) — must run SQL by hand.
- **No org-wide settings page** — k-anonymity threshold, working-hours
  policy, notification cadence are all code constants.
- **No billing or subscription management** (relevant for V1 SaaS pivot).

### 2.11 Analytics & insight
- **No cohort analysis** (how often people who took session X also
  request session Y).
- **No funnel tracking** (signup → onboarding → first match → first
  session → second session).
- **No NPS or CSAT capture** beyond the per-session 5-star rating.
- **No exportable "skills momentum" report** for HR strategy decks.
- **No skill-trend over time** in the personal landscape — current view is
  a snapshot, not a curve.

### 2.12 UI / accessibility
- **Hover-only popovers** (V1 item 14) — fails on touch + keyboard.
- **No ARIA labels in many places**.
- **No keyboard-only nav audit**.
- **No alternative non-color signal** in the red→green skill landscape.
- **No high-contrast / dark mode**.
- **No internationalization** (V1 item 15).
- **No mobile-native or PWA install** (V1 item 16).

### 2.13 Performance / scale
- **All matches recomputed on every change** (V1 item 9) — fine at 300
  users, breaks somewhere between 5k-50k.
- **No caching layer** in front of the DB; every read hits SQLite.
- **No background job queue** — long operations run in-request.
- **No horizontal scaling story** — single process, single SQLite file.
  SaaS pivot requires Postgres + a real ORM or query layer.
- **No CDN for static assets**; Express serves the Vite bundle directly.

### 2.14 Data integrity / DX
- **Jest suites exist** for matching, session privacy, reflection apply, auth
  gate, and profile ingest — run via `npm test`.
- **CI** — GitHub Actions workflow (`.github/workflows/test.yml`) runs tests
  on push/PR to `main`.
- **No environment-specific config**; `process.env.NODE_ENV` is the only
  switch, and most config is hardcoded.
- **No structured logging** — `console.error` only.
- **No error tracking** (Sentry, Bugsnag, etc.).

### 2.15 Legal / compliance
- **No Terms of Service or Privacy Policy** rendered in-app.
- **No consent capture** at signup.
- **No GDPR data-export endpoint** for the user's own data.
- **No "right to be forgotten" flow** (V1 item 13).
- **No data-residency story** for EU customers.
- **No DPA template** for SMEs that need one.

### 2.16 Business / GTM (out of code, but worth tracking)
- *No pricing page or billing system yet.*
- *No public landing page deployed* (the landing copy in `pilot-kit/`
  exists as a markdown file but no hosted site).
- *No demo environment* accessible to prospects.
- *No analytics on the pilot kit itself* — email opens, reply rates.

---

## Part 3 — Recommended sequencing if we move toward V1

A rough "what to tackle first" stack, based on impact × risk:

1. **Multi-tenancy schema migration** (1-2 weeks). Blocking everything
   else in the cross-company direction.
3. **Email infrastructure** + transactional templates (1 week). Unblocks
   notifications, password reset, invitations, the weekly nudge cadence.
4. **Manager re-engagement features** (assign reports, skip-level, KPI
   view) (1 week).
5. **Calendar OAuth** (Google first, Microsoft second) (1-2 weeks).
6. **CSV export + audit retention** (2 days).
7. **Internationalization + accessibility pass** (1 week).
8. **Postgres migration** (when scale demands).

Everything in [V1-FOLLOWUPS.md](V1-FOLLOWUPS.md) item 1-20 fits into the
"V1 features and polish" tier.

---

*Document last updated: 2026-05-21. Maintain by hand or regenerate from
this exact prompt as the codebase evolves.*
