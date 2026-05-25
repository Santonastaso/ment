# MENT — Micro-Mentoring Platform

Internal micro-mentoring platform for large organizations. Employees are matched with colleagues based on skill overlap, career history, and department diversity. Sessions are booked in-app and tracked from request through reflection.

The app is **server-less**: a React client talks directly to **Supabase** (Auth + Postgres + RLS + Storage + Edge Functions + pg_cron).

---

## Architecture

```
/
├── client/                       React + Vite (the only app process)
│   └── src/
│       ├── pages/                Login, Onboarding, Dashboard, Profile, …
│       ├── components/           MatchCard, SessionCard, IcsDownloadButton, …
│       ├── context/AuthContext   Wraps supabase.auth + profile fetch
│       ├── api/index.js          Backwards-compatible shim that routes
│       │                         legacy api.get/post/put/delete to supabase-js
│       └── lib/
│           ├── supabase.js       Browser supabase-js client (anon key)
│           └── ics.js            In-browser .ics calendar generator
├── supabase/
│   ├── migrations/0001_init.sql       Tables, indexes
│   ├── migrations/0002_functions.sql  Triggers, RPCs (matching, badges,
│   │                                   skill progress, team gaps, session
│   │                                   lifecycle, audit log)
│   ├── migrations/0003_rls.sql        RLS policies + grants
│   ├── migrations/0004_cron.sql       pg_cron: weekly check-in, nightly
│   │                                   match recompute
│   ├── migrations/0005_storage.sql    Buckets + storage RLS
│   ├── migrations/0006_org_privacy_demo_fixes.sql
│   │                                   Organizations, redacted directory RPCs,
│   │                                   org-scoped admin, privacy RLS
│   ├── migrations/0007_access_requests_org_admin.sql
│   │                                   Request-access leads, org creation RPCs,
│   │                                   privacy/AI status RPC
│   ├── functions/                     Deno Edge Functions:
│   │   ├── admin-create-user/         CSV/XLSX bulk import
│   │   ├── admin-reset-password/      Generates a fresh temp password
│   │   ├── profile-ingest/            PDF/DOCX → heuristic/ESCO profile draft
│   │   └── reflection-classify/       Heuristic/ESCO skill extraction
│   └── config.toml
```

No Express server. No JWT secret. No CORS. No bcrypt. No nightly cron jobs to babysit.

---

## Quick start

### Prerequisites
- Node.js 20+.
- Supabase CLI, logged in with access to the project.
- A Supabase project (free tier is enough). Create one with:

  ```bash
  curl -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Ment","organization_id":"YOUR_ORG","region":"eu-central-1","db_pass":"<generated>"}' \
    https://api.supabase.com/v1/projects
  ```

  Capture `ref`, anon key, and service role key. The Management API also exposes them at `/v1/projects/{ref}/api-keys`.

### 1. Configure secrets

```bash
cp .env.example .env
# Fill in SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_URL,
# SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and optional SUPABASE_DB_URL
```

`client/.env.local` only needs the public bits:

```
VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

### 2. Apply the schema

```bash
source .env

supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
supabase db lint --linked
```

Supabase CLI owns migration application and linting; there is no local SQL runner in this repo.

### 3. Deploy Edge Functions

```bash
supabase functions deploy admin-create-user admin-reset-password \
  profile-ingest reflection-classify

# Optional — enables Anthropic-powered profile/reflection classification.
# The default is off even when ANTHROPIC_API_KEY is present.
supabase secrets set AI_CLASSIFICATION_ENABLED=true ANTHROPIC_API_KEY=sk-...
```

### 4. Run the client

```bash
npm install
npm run dev      # http://localhost:3000
```

### 5. Hosted build (Vercel)

Production hosting is **Vercel**. Build is driven by [`vercel.json`](./vercel.json): `npm install --prefix client && npm run build --prefix client`, output `client/dist`. SPA rewrites are handled by `vercel.json` (no `404.html` shim needed).

1. Vercel → Project → Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Add the deployed origin (e.g. `https://ment-steel.vercel.app`) to Supabase Auth allow list:
   ```bash
   curl -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"site_url":"https://ment-steel.vercel.app","uri_allow_list":"http://localhost:3000,https://ment-steel.vercel.app,https://*-asantonastaso.vercel.app"}' \
     https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth
   ```

Preview deployments are automatic on every PR.

GitHub Actions expects these repository secrets for Supabase checks and function deploys:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_URL` (optional, used for DB lint without linking)

CI also runs a full-history Gitleaks scan from the official CLI container with redacted output. Keep `actions/checkout` at `fetch-depth: 0` for that job so a secret committed and then removed still fails the PR.

---

## Test credentials

Seed/test users are managed in Supabase Auth. Admin-created users receive a one-time temporary password from the admin import/reset flows and must rotate it on first login.

`alice.chen@ment.io` is the admin.

---

## Features

### Employee experience
- **Dashboard**: top mentor suggestions, active sessions split into "needs your attention" and "upcoming", weekly reflection check-in nudge.
- **Profile**: edit skills, career history, view earned badges, expertise signature ("what colleagues seek you out for").
- **Match cards**: request a session or dismiss with one click. Dismissals re-rank future matches.
- **Session flow**: focus question → propose a time → mentor accepts → calendar `.ics` generated in-browser → mark complete with private reflection + 1–5 rating.
- **Reflection log**: weekly two-question check-in. Curated keyword matching + ESCO extract skills you can apply to your landscape; Anthropic is opt-in.
- **Onboarding wizard**: optional CV/perf-review upload (PDF/DOCX) prefills the form via heuristic + ESCO extraction; Anthropic is opt-in.

### Admin experience
- **Stats**: users, onboarding rate, sessions by status, top mentors, department activity, silos.
- **Bulk import**: CSV/XLSX → Edge Function → `auth.admin.createUser` per row → automatic match recompute.
- **Manage users**: set manager, reset password, deactivate.
- **Organizations**: platform admins can create lightweight client orgs, copy org IDs, and export owner reporting CSV.
- **Access requests**: platform admins can review public request-access submissions and mark them `new`, `contacted`, or `closed`.
- **Privacy / AI status**: admins can see peer-visible fields, hidden fields, Supabase region, and configured Edge Functions.
- **Audit log**: every important state change is captured by Postgres triggers; downloadable CSV.
- **Send reflection notes**: manual override of the weekly `pg_cron` broadcast.
- **Owner reporting**: platform admins can see cross-organization usage, onboarding, active members, sessions, and deactivation counts.

---

## CSV/XLSX import format

| Column           | Required | Notes                                |
|------------------|----------|--------------------------------------|
| `name`           | Yes      | Full name                            |
| `email`          | Yes      | Becomes the auth.users login         |
| `department`     | No       | Engineering, Finance, Marketing, …   |
| `current_role`   | No       | Job title (stored as `job_title`)    |
| `seniority`      | No       | `junior`, `mid`, `senior`, `lead`    |
| `tenure_years`   | No       | Integer                              |
| `location`       | No       | Free text                            |
| `manager_email`  | No       | Email of an already-imported user    |
| `can_teach`      | No       | Comma-separated skills               |
| `wants_to_learn` | No       | Comma-separated skills               |

All imported users land with `must_change_password = true` and a shared temp password (returned once to the admin who triggered the upload).

---

## Matching algorithm

Stored as a Postgres function (`public.recompute_matches_for(uuid)`). Matching is scoped to users in the same `organization_id`.

| Signal                | Max pts | Logic                                                                  |
|-----------------------|---------|------------------------------------------------------------------------|
| Skill overlap         | 40      | 10 pts per distinct (lower-cased, trimmed) skill where A teaches B's wants-to-learn or vice versa |
| Career crossover      | 20      | +20 if either user previously worked in the other's current department |
| Department diversity  | 25      | +25 if departments differ                                              |

Only pairs scoring >= 30 are stored. Viewer-specific adjustments (accept/decline volumes and rating averages per department) are layered on at read time inside `public.get_matches_for(...)`. Explorer can request `includeDirectory=1` to fill with same-org directory candidates when scored matches are sparse.

Recompute fires:
- On profile/skill/career changes (via the SQL function the client calls after writes).
- Nightly at 03:15 UTC via `pg_cron` (`mt-nightly-rematch`).
- On admin "Re-run matching".

Client signup is intentionally deferred. Public `/request-access` submissions are stored as leads only; platform admins still provision new client organizations manually through the Admin Organizations tab and assign imported users to that `organization_id`.

---

## Schedules (pg_cron)

| Job                  | Schedule        | What                                                |
|----------------------|-----------------|-----------------------------------------------------|
| `mt-weekly-checkin`  | `0 9 * * MON`   | Sets `pending_checkin = true` on all active users.  |
| `mt-nightly-rematch` | `15 3 * * *`    | Calls `recompute_all_matches()` for the whole org.  |

---

## Recognition badges

| Badge | Condition |
|-------|-----------|
| First Step | Completed first session |
| Connector | Sessions with people from 3+ departments |
| Deep Expert | Requested as mentor 5+ times |
| Explorer | Completed session with someone from a different department |

Computed on-demand by `public.badges_for(uuid)`.

---

## Current backlog notes

These are the useful V1 notes that still apply after the Supabase migration:

- **Notifications**: in-app prompts depend on the browser being open. Service Worker + Push API or email delivery are still future work.
- **Calendar**: `.ics` download is the only calendar integration. Google/Microsoft OAuth, availability, and two-way sync are not implemented.
- **AI classification**: Anthropic is opt-in and the default heuristic/ESCO path is the production-safe baseline. Prompt calibration, few-shot examples, and shorter display aliases for long ESCO labels remain V1 polish.
- **Matching**: feedback is still coarse-grained around departments. Per-skill feedback and incremental match recompute would matter at larger scale.
- **Privacy and admin ops**: audit export exists, but retention policy, GDPR export/delete workflows, org-level settings, 2FA/SSO, and legal consent screens are not built.
- **Accessibility/i18n/PWA**: UI strings are English only, no PWA install/offline mode exists, and touch/keyboard accessibility should get a dedicated audit before broad rollout.
- **Analytics**: owner/org CSV export exists, but deeper anonymized HR analytics and funnel/cohort reporting are not yet productized.

---

## Operating notes

- **Auth**: `auth.users` owns identities. `public.profiles.id = auth.users.id`. A trigger creates the profile on signup. `must_change_password` blocks the user at the route level (App.jsx) and is cleared by the `complete_password_change` RPC after `auth.updateUser({ password })`.
- **Organizations**: one Supabase project hosts multiple organizations. `profiles.organization_id` scopes matching, sessions, team insights, admin lists, imports, audit views, and broadcasts. `admin_scope` is `none`, `org`, or `platform`; `is_admin` remains as a compatibility flag.
- **Authorization**: RLS is enabled on every public table. Raw profile, skill, and career rows are self-only. Peer/directory data is served through redacted RPCs. Writes are scoped to `user_id = auth.uid()` or are gated through `security definer` RPCs (sessions, connections, admin actions, broadcast).
- **Default profile privacy**: other colleagues see first name + last initial, role, department, location, bio, and teachable skills. Company names, career details, wants-to-learn, shadow-role answers, reflections, and ratings are private by default.
- **Audit log**: written exclusively by triggers and the admin RPCs, never by app code. Sensitive content is never recorded — only actions and counts.
- **Storage**: two private buckets (`profile-uploads`, `imports`) with RLS so users only see their own uploads and admins only access their own import paths unless they are platform admins.
- **Edge Functions**: Deno; verify_jwt is on. Anthropic is disabled unless `AI_CLASSIFICATION_ENABLED=true`; the Anthropic key lives in `supabase secrets`, never in the client bundle.

## Privacy/compliance notes

- Supabase projects are deployed to one primary region; Supabase documents `eu-central-1` as Central EU / Frankfurt in its [available regions](https://supabase.com/docs/guides/platform/regions).
- Supabase provides hosted security/compliance controls and links to its DPA from the official [Supabase security docs](https://supabase.com/docs/guides/security) and [DPA](https://supabase.com/legal/dpa). Verify the current DPA/subprocessor schedule before signing a client.
- Anthropic processing is off by default. If enabled, verify Anthropic's current commercial terms/DPA flow from the [Anthropic Privacy Center](https://privacy.anthropic.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa) first.
