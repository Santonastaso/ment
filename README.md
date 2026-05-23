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
│   ├── functions/                     Deno Edge Functions:
│   │   ├── admin-create-user/         CSV/XLSX bulk import
│   │   ├── admin-reset-password/      Generates a fresh temp password
│   │   ├── profile-ingest/            PDF/DOCX → Anthropic → profile draft
│   │   └── reflection-classify/       Anthropic + ESCO skill extraction
│   └── config.toml
└── scripts/
    ├── db-query.mjs              Runs a SQL file via the Management API
    └── migrate-from-sqlite.mjs   One-shot SQLite → Supabase backfill
```

No Express server. No JWT secret. No CORS. No bcrypt. No nightly cron jobs to babysit.

---

## Quick start

### Prerequisites
- Node.js 20+ (the build runs on Node 20; the migration script wants Node 22 for native WebSocket).
- A Supabase project (free tier is enough). Create one with:

  ```bash
  curl -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
    -H "Content-Type: application/json" \
    -d '{"name":"Ment","organization_id":"YOUR_ORG","region":"eu-central-1","db_pass":"<generated>"}' \
    https://api.supabase.com/v1/projects
  ```

  Capture `ref`, anon key, and service role key. The Management API also exposes them at `/v1/projects/{ref}/api-keys`.

### 1. Configure secrets

```bash
cp .env.example .env
# Fill in SUPABASE_PAT, SUPABASE_PROJECT_REF, SUPABASE_URL,
# SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

`client/.env.local` only needs the public bits:

```
VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

### 2. Apply the schema

```bash
source .env

node scripts/db-query.mjs supabase/migrations/0001_init.sql
node scripts/db-query.mjs supabase/migrations/0002_functions.sql
node scripts/db-query.mjs supabase/migrations/0003_rls.sql
node scripts/db-query.mjs supabase/migrations/0004_cron.sql
node scripts/db-query.mjs supabase/migrations/0005_storage.sql
```

(Or `supabase db push --linked` if you have the CLI set up.)

### 3. Deploy Edge Functions

```bash
supabase functions deploy admin-create-user admin-reset-password \
  profile-ingest reflection-classify

# Optional — enables Anthropic-powered profile/reflection classification
supabase secrets set ANTHROPIC_API_KEY=sk-...
```

### 4. (Optional) backfill from an existing SQLite DB

If you're upgrading from the legacy SQLite POC:

```bash
nvm use 22
SQLITE_PATH=./ment.db npm run migrate:from-sqlite
```

`better-sqlite3` is a root devDependency (Node-22 ABI). The script prints a one-time temp password every migrated user must rotate on first login.

### 5. Run the client

```bash
npm install
npm run dev      # http://localhost:3000
```

### 6. Hosted build (GitHub Pages)

`.github/workflows/deploy.yml` builds `client/dist` and ships it to GitHub Pages on every push to `main`. To enable:

1. Settings → Pages → Source = "GitHub Actions".
2. Settings → Secrets and variables → Actions → **Variables**, set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Add the deployed origin to Supabase Auth allow list:
   ```bash
   curl -X PATCH -H "Authorization: Bearer $SUPABASE_PAT" \
     -H "Content-Type: application/json" \
     -d '{"site_url":"https://<owner>.github.io/<repo>","uri_allow_list":"http://localhost:3000,https://<owner>.github.io/<repo>"}' \
     https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth
   ```

`client/public/404.html` covers SPA deep links. Vite's `base` is set to `/<repo>/` via the workflow's `BASE_PATH` env var, and `BrowserRouter` consumes the same value via `import.meta.env.BASE_URL`.

---

## Test credentials

After the legacy SQLite migration, seeded users keep the existing email addresses (`alice.chen@ment.io`, `bob.taylor@ment.io`, …). The temp password is printed once by the migration script.

`alice.chen@ment.io` is the admin.

---

## Features

### Employee experience
- **Dashboard**: top mentor suggestions, active sessions split into "needs your attention" and "upcoming", weekly reflection check-in nudge.
- **Profile**: edit skills, career history, view earned badges, expertise signature ("what colleagues seek you out for").
- **Match cards**: request a session or dismiss with one click. Dismissals re-rank future matches.
- **Session flow**: focus question → propose a time → mentor accepts → calendar `.ics` generated in-browser → mark complete with private reflection + 1–5 rating.
- **Reflection log**: weekly two-question check-in. Anthropic + ESCO extract skills you can apply to your landscape.
- **Onboarding wizard**: optional CV/perf-review upload (PDF/DOCX) prefills the form via Anthropic + ESCO.

### Admin experience
- **Stats**: users, onboarding rate, sessions by status, top mentors, department activity, silos.
- **Bulk import**: CSV/XLSX → Edge Function → `auth.admin.createUser` per row → automatic match recompute.
- **Manage users**: set manager, reset password, deactivate.
- **Audit log**: every important state change is captured by Postgres triggers; downloadable CSV.
- **Send reflection notes**: manual override of the weekly `pg_cron` broadcast.

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

Stored as a Postgres function (`public.recompute_matches_for(uuid)`). Same scoring as before:

| Signal                | Max pts | Logic                                                                  |
|-----------------------|---------|------------------------------------------------------------------------|
| Skill overlap         | 40      | 10 pts per distinct (lower-cased, trimmed) skill where A teaches B's wants-to-learn or vice versa |
| Career crossover      | 20      | +20 if either user previously worked in the other's current department |
| Department diversity  | 25      | +25 if departments differ                                              |

Only pairs scoring ≥ 30 are stored. Viewer-specific adjustments (accept/decline volumes and rating averages per department) are layered on at read time inside `public.get_matches_for(...)`.

Recompute fires:
- On profile/skill/career changes (via the SQL function the client calls after writes).
- Nightly at 03:15 UTC via `pg_cron` (`mt-nightly-rematch`).
- On admin "Re-run matching".

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

## Operating notes

- **Auth**: `auth.users` owns identities. `public.profiles.id = auth.users.id`. A trigger creates the profile on signup. `must_change_password` blocks the user at the route level (App.jsx) and is cleared by the `complete_password_change` RPC after `auth.updateUser({ password })`.
- **Authorization**: RLS is enabled on every public table. Reads are broad enough for the directory; writes are scoped to `user_id = auth.uid()` or are gated through `security definer` RPCs (sessions, connections, admin actions, broadcast).
- **Audit log**: written exclusively by triggers and the admin RPCs, never by app code. Sensitive content is never recorded — only actions and counts.
- **Storage**: two private buckets (`profile-uploads`, `imports`) with RLS so users only see their own uploads and admins see imports.
- **Edge Functions**: Deno; verify_jwt is on. The Anthropic key lives in `supabase secrets`, never in the client bundle.
