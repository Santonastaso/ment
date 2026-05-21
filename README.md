# MENT — Micro-Mentoring Platform

An internal micro-mentoring platform for large organizations. Employees are matched with colleagues based on skill overlap, career history, and department diversity. Sessions are booked in-app and tracked from request through reflection.

---

## Quick Start

```bash
npm install        # installs server + client dependencies
npm run seed       # seeds the database with 15 sample employees and 65 match pairs
npm start          # starts server (:3001) and client dev server (:3000) concurrently
```

Then open **http://localhost:3000**.

> The seed step only needs to run once. The database is stored in `server/ment.db`.

---

## Test Credentials

After `npm run seed`, the script prints a **one-time temporary password** for demo accounts. Each user must change it on first login.

| Role     | Email                    | Notes                              |
|----------|--------------------------|------------------------------------|
| Admin    | alice.chen@ment.io       | Access to admin dashboard          |
| Employee | bob.taylor@ment.io       | Has a pending session with David   |
| Employee | frank.wu@ment.io         | Finance lead, ex-Engineering       |
| Employee | jack.wilson@ment.io      | Has a completed session with Leo   |
| Employee | mia.white@ment.io        | Operations lead, ex-Marketing      |
| Employee | david.park@ment.io       | Junior engineer, lots of matches   |

---

## Features

### Employee experience
- **Dashboard**: See top 5 matches with reasons, manage sessions, view private reflections
- **Match cards**: Request a session or dismiss a suggestion (removes from list privately)
- **Session flow**: Submit a focus question → propose a time → mentor accepts → download .ics
- **Post-session reflection**: Mark complete and write what you'll do differently
- **Profile**: Edit skills, career history, view earned badges
- **Onboarding wizard**: 3-step setup on first login

### Admin experience
- **Stats dashboard**: Users, onboarding rate, sessions by status, top mentors, department silos
- **Bulk import**: Upload CSV/XLSX to create employee accounts in bulk
- **Re-run matching**: Recompute all match scores after profile changes

---

## CSV/XLSX Import Format

| Column          | Required | Notes                                  |
|-----------------|----------|----------------------------------------|
| `name`          | Yes      | Full name                              |
| `email`         | Yes      | Used as login credential               |
| `department`    | No       | Engineering, Finance, Marketing, etc.  |
| `current_role`  | No       | Job title                              |
| `seniority`     | No       | `junior`, `mid`, `senior`, or `lead`   |
| `tenure_years`  | No       | Integer                                |
| `can_teach`     | No       | Comma-separated skills                 |
| `wants_to_learn`| No       | Comma-separated skills                 |

All imported users get a **random temporary password** (shown once to the admin after upload). Users must change it on first login.

Download a pre-formatted template from the Admin Dashboard → Import section.

---

## Matching Algorithm

Each employee pair receives a base score from 0–85 (seniority is intentionally not used):

| Signal | Max pts | Logic |
|--------|---------|-------|
| Skill overlap | 40 | 10pts per skill where A teaches what B wants to learn (or vice versa) |
| Career crossover | 20 | +20 if either person previously worked in the other's current department |
| Department diversity | 25 | +25 if different departments |

Viewer-specific adjustments (accept/decline history and session ratings per department) are stacked on top of the base score — see `server/utils/matching.js`.

Only pairs scoring ≥ 30 are stored. Matching runs automatically after import, onboarding completion, and via the admin "Re-run matching" button.

---

## Architecture

```
/
├── package.json          root scripts + concurrently
├── server/               Node.js + Express API
│   ├── index.js          server entry point (port 3001)
│   ├── ment.db           SQLite database (auto-created)
│   ├── db/               schema, seed, database connection
│   ├── middleware/        JWT auth + admin guard
│   ├── routes/           auth, users, matches, connections, sessions, admin
│   └── utils/            matching algorithm, ICS generator
└── client/               React + Tailwind (Vite)
    └── src/
        ├── pages/         Login, Onboarding, Dashboard, Profile, AdminDashboard
        ├── components/    MatchCard, SessionCard, SkillTagInput, BadgeDisplay, …
        ├── context/       AuthContext (JWT storage + user state)
        └── api/           Axios instance with JWT interceptor
```

In development, Vite proxies `/api` requests to Express on port 3001.

---

## Environment

Copy `.env.example` to `server/.env` (or export variables before starting):

```bash
export JWT_SECRET=$(openssl rand -hex 32)   # required
export ANTHROPIC_API_KEY=sk-...             # optional — profile import + reflection AI
```

---

## Deploying a pilot instance

```bash
docker build -t ment:latest .
docker run -d \
  -p 3001:3001 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ANTHROPIC_API_KEY="your-key" \
  -v ment-data:/data \
  ment:latest
```

Open `http://localhost:3001`. SQLite lives in the `/data` volume (`DB_PATH=/data/ment.db`).

One container per pilot customer — no multi-tenancy in the POC.

---

## Recognition Badges

| Badge | Condition |
|-------|-----------|
| 🌱 First Step | Completed first session |
| 🔗 Connector | Sessions with people from 3+ departments |
| ⭐ Deep Expert | Requested as mentor 5+ times |
| 🧭 Explorer | Completed session with someone from a different department |

Locked badges are shown in grey with the unlock condition.
