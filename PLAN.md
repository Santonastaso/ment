# MENT — PM Feedback Implementation Plan

_Source: PM feedback notes (Frank Wu / Alice Chen / general + Zurich decisions). Grounded in codebase audit of 2026-08._

---

## 0. Answers to the PM's questions (send back before building)

| Question | Answer |
|---|---|
| **Student groups — feasible? costly?** | Technically simple: two new tables (`groups`, `group_members`) + RLS, same pattern as everything else. **Zero API/token cost** — no LLM involved. Real cost = dev time (~2-3 days) + a new moderation surface (who approves, content inside groups). Recommendation: post-pilot. |
| **Where does Help & Feedback end up?** | Today: stored in `feedback_messages` table, visible only in Admin → Feedback tab. **No email anywhere.** Proposal: create `support@ment…` address + wire forwarding (see Wave 7). |
| **Matching logic & weights** (Zurich promise) | Deliverable: one-pager for PM. Skill overlap 40 pts (10/skill), career crossover 20, department diversity 25, threshold ≥30, plus read-time adjustments from ratings/accepts/declines. |
| **Does search/directory burn tokens?** | **No — important misconception to correct.** Matching and directory are pure Postgres (`get_matches_for`, `pair_affinity`). The only thing that costs tokens is Anthropic classification, which is off by default. The "no matches in directory" decision can therefore be made purely on UX grounds (user-intent clarity), not cost. |

---

## Wave 0 — Quick wins (each ≤ half day)

| # | Item | Where | Notes |
|---|---|---|---|
| 1 | Tab title → `ment · Ask & Learn` | `client/index.html:6` | Static, not i18n |
| 2 | Landing: SME + Enterprise cards → **University** | `LandingPage.jsx:70-105`, `locales/*/landing.json` `products.*` | Copy rewrite |
| 3 | "Skills you share" → **"Your strengths"** | `locales/*/components.json` `skillLandscape.shareTitleOwn/Other` + `reflection.skillsShare` | Rename in en/it (+fr when created) |
| 4 | "Mentors for you" → **"Matched for you"** | `locales/*/dashboard.json` `dashboard.mentors.*` | PM's pick. DB keeps `mentor_id/mentee_id` internally — only labels change |
| 5 | Remove **Recognition** + **Shadow role** sections | `Profile.jsx:928-963, 965-972`; onboarding shadow step | UI-only; keep DB columns (`shadow_role_response`) for now |
| 6 | Top-bar search → Explorer | `TopBar.jsx:13-19` | **Already implemented** (`/explorer?q=`) — just verify behavior is what PM expects |

## Wave 1 — Profile & data model (the school pivot) — ~2 days + 1 migration

**Migration `0024_school_pivot.sql`:**

- `profiles.program text`, `profiles.cohort_year int` ("class of") — nothing like this exists today
- Role pivot: replace `role ∈ {admin, team_lead, manager, employee}` (0021) with client-facing **`student | alumnus`**; permissions stay on `admin_scope` (untouched). Existing rows default to `student`
- Name lock: extend `guard_profile_writes` trigger to reject self-updates of `name` (admins keep service-role path)

**Client:**

- Profile form: add Program + Class-of, name becomes read-only text, department select (`DEPARTMENTS` hardcoded array, `Profile.jsx:22`) → replaced/augmented by program
- Onboarding wizard: same fields + student/alumnus picker, drop shadow-role step
- Remove **Team Insights** entirely: `/team` route (`App.jsx:90-98`), `TeamSkills.jsx`, Sidebar item, `team_lead|manager` gating — consistent with role pivot
- CSV import format: add `program`, `cohort_year`, `persona` columns (README table + `admin-create-user` function + admin import UI)

⚠️ Open decision: how to classify existing users (default `student` and let admins bulk-edit? ask at next login?)

## Wave 2 — Home experience — ~1 day

- **Greeting** (PM's preferred option 2 — no new state): key off conversation count. 0 → "Hi [Name] — what's on your mind today?"; 1+ → "Hi [Name] — you've had N conversations so far…". Count derivable from `/sessions` already fetched; kill `welcomeTitle` "Welcome back"
- **Half-height hero**: compact PageShell variant
- **Snapshot strip**: 3 tappable counters — `X upcoming · Y need reflection · Z new requests` — data already fetched (`/sessions`, `/sessions/pending-acceptances`, needs-attention calc at `Dashboard.jsx:202-211`). Tap = scroll/jump to filtered section; full lists stay below fold

## Wave 3 — Matching engine — ~1-2 days + 1 migration

- **Debounced recompute** (PIT's design, satisfies FRA): add `profiles.matches_stale boolean`; replace the direct `recompute_matches_for` calls (`save_onboarding`, `apply_reflection`, client post-write calls) with a cheap flag set; new pg_cron job every ~5 min recomputes stale users in batches and clears flags. Keep: nightly full recompute, immediate recompute on session completion
- **Fix "Re-run matching" error**: most likely cause is `admin_recompute_matches` → `recompute_all_matches()` being O(N²) and hitting statement timeout on hosted PG. Fix = batched per-user `_recompute_matches_for` loop. *Need the actual error text — screenshot didn't come through*
- Write the **matching-logic one-pager** for the PM

## Wave 4 — Knowledge graph — ~1-2 days + RPC changes

- `knowledge_graph()` RPC (`0016`): add **person→person edges** from `sessions (status='completed')` + `connections (status='accepted')` — that's the "connections that actually happened" overlay; new edge types/colors/legend + layer toggles in `KnowledgeGraph.jsx`
- **Company → Program**: group/filter by new `profiles.program` within the org (RPC param or client-side grouping)

## Wave 5 — Admin split (school vs platform) — ~1 day

Both exist already as `admin_scope: 'org' | 'platform'` — this is a UI reorg, RLS already enforces data access:

- `/admin` = **school admin view**: own-org users, KPIs, import, feedback, audit, graph
- New `/admin/ops` = **platform-only**: owner reporting, organizations, access requests, tier-change queue, cross-org stats (moved from current tabs at `AdminDashboard.jsx`)

## Wave 6 — Explorer rework (biggest item) — ~3-4 days + 1 RPC

- Entry prompt: **"Looking to connect with a student or an alumnus?"** (uses Wave 1 persona field)
- **Chat-style (lazy)**: free-text box → top 3 matches. Keyword matching against skills/roles in SQL/JS = **free**. True semantic NL search would cost embeddings/LLM — explicitly out of scope for pilot
- **Directory-style (control)**: new redacted directory RPC with real pagination + filters (program, cohort year, location, `working_language` — column already exists from 0016, persona). No match scores shown, per PM decision
- Mode toggle, persisted in URL like today's `?q=`

## Wave 7 — Comms & email — ~1-2 days + external setup

- **Reflection reminder emails**: repo has zero email infra. Plan: new edge function + pg_cron (extend weekly check-in job) + **Resend** free tier (3k msgs/mo). Needs: sender domain verification, opt-out preference column
- **Help & Feedback → email**: forward new `feedback_messages` to support address via same provider; create the mailbox first

## Wave 8 — FR locale — continuous, finalize last

New `locales/fr/` (11 namespaces mirroring en/it) + LanguageSwitcher option + `check:i18n` coverage. **Do it last** so every string added above gets translated once, not twice.

---

## Suggested sequence

**Waves 0 → 1 → 2 → 3** first (visible wins + schema foundation everything else depends on), then 4/5/7 in parallel, then 6 (explorer), FR last. Roughly **10-14 dev days** total.

## Open questions before starting

1. Actual error text/screenshots for Re-run matching (and for the KG/admin annotations that referenced images that didn't come through)
2. Existing users → default `student` + admin bulk-edit, or forced re-pick at login?
3. Does `department` die everywhere in favor of `program`, or coexist?
4. Support/sender email domain for feedback + reminders?
5. Groups: confirm post-pilot?
