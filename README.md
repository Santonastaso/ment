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

All accounts use the password: **`ment2026`**

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

All imported users get the default password **`ment2026`** (shown to admin after upload).

Download a pre-formatted template from the Admin Dashboard → Import section.

---

## Matching Algorithm

Each employee pair receives a score from 0–100:

| Signal | Max pts | Logic |
|--------|---------|-------|
| Skill overlap | 40 | 10pts per skill where A teaches what B wants to learn (or vice versa) |
| Career crossover | 20 | +20 if either person previously worked in the other's current department |
| Seniority gap | 15 | +15 if 1 level apart, +10 if 2 levels apart |
| Department diversity | 25 | +25 if different departments |

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

## Recognition Badges

| Badge | Condition |
|-------|-----------|
| 🌱 First Step | Completed first session |
| 🔗 Connector | Sessions with people from 3+ departments |
| ⭐ Deep Expert | Requested as mentor 5+ times |
| 🧭 Explorer | Completed session with someone from a different department |

Locked badges are shown in grey with the unlock condition.
