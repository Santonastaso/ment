# MENT — context and conversation guide for a potential technical co-founder

*This document has two halves. The first half is read-ahead — what MENT is and what we'd be building. The second half is the conversation itself — questions worth walking through together before either of us commits.*

---

## Part 1 — Read this before we talk

### What MENT is

Curated peer mentoring for small companies and enterprises. Two product hypotheses, both being validated in parallel:

- **SMEs (5-50 ppl):** their employees are matched with peers at *other* small, non-competing companies for cross-company learning. Manual concierge in pilot phase.
- **Enterprises (400+ ppl):** their employees are matched with each other internally, via software that surfaces who can help whom.

We don't yet know which wins. The 12-week validation plan tests both before any further build investment. See `one-pager.md` for the structured plan.

### Where we are today

- A working internal-mentoring web app exists and runs locally — this is our enterprise demo asset on day one.
- A manual SME pilot kit is ready: Airtable schema, onboarding form, post-session reflection form, email templates, landing copy, employee FAQ.
- One landing page (Carrd) being prepared for the SME-buyer side.
- Zero paying customers. Validation hasn't started in earnest.
- Founder works full-time elsewhere; all activity unpaid until employer permission is in writing. Hard bright line.

### What exists technically (the dev MVP)

A working full-stack app. Built solo with AI-assisted coding, so the code is functional but not professionally reviewed. A real engineer would want to read it before committing — that's healthy.

**Stack:**
- **Backend:** Node.js + Express, JWT auth, better-sqlite3 (SQLite)
- **Frontend:** React + Vite + Tailwind CSS
- **External:** ESCO API (free, public, EU skill taxonomy), optional Anthropic Claude integration via `ANTHROPIC_API_KEY`
- **Hosting:** localhost only. No production deploy yet.

**Functional features (all working):**
- Three-step onboarding (background → can-teach skills with example projects → wants-to-learn skills + open question)
- Rule-based matching algorithm (skill overlap, career cross-pollination, department diversity)
- Personalized match reasons rendered per-viewer (correct "you / them" attribution)
- Session lifecycle: request → accept → meet → mark complete → reflect (both sides have private reflections)
- Reflection log with AI-or-heuristic skill classification, ESCO canonicalization, apply-to-profile flow
- Skill landscape visualization (red→green for gaps, blue→gold for strengths)
- Dashboard split into "Needs your attention" and "Upcoming"
- Past meetings with ex-post reflection editing
- Reschedule / cancel actions on sessions
- Admin: CSV bulk upload of employees, weekly check-in broadcast, audit log, anonymized team skill-gaps report (manager view)
- 300-employee seed dataset for demos

**What's deliberately not in V1 (documented):**
- Service Worker push for offline notifications
- OAuth calendar integration (we generate `.ics` instead)
- Real LLM-tuned classifier prompt (current is generic)
- Per-role session completion (one side marking it complete ends the prompt for both)
- ~15 other items, all enumerated in `V1-FOLLOWUPS.md`

### What the build looks like for cross-company SME variant

If the SME track validates and we decide to build the software variant, the work is roughly:

| Workstream | What it involves | Rough effort |
|---|---|---|
| **Multi-tenancy** | `org_id` on every table; query filters; admin scoped per SME | 1-2 wks |
| **Anonymity layer** | Profile views with redacted identity; opt-in identity reveal; suggestion email rendering | 1 wk |
| **Anti-competitor matching** | Company-to-company competitor table; algorithm exclusion logic | 0.5 wk |
| **SME admin role** | Per-SME admin distinct from platform admin; SME admin sees only their team | 0.5-1 wk |
| **Real authentication** | Email magic link (replace shared-password seed); password reset; session management | 1 wk |
| **SME signup + employee invite flow** | Self-serve onboarding for new SMEs; bulk invite; per-seat tracking | 1-1.5 wks |
| **Billing** | Stripe integration, per-seat subscription, trial → paid transition | 1-1.5 wks |
| **Production deployment** | Render / Fly / Railway; backups; monitoring; CI/CD; security hardening | 1 wk |
| **GDPR / privacy** | Right-to-erasure, data export, processor agreements baked into product | 0.5-1 wk |
| **Observability** | Logging, error tracking (Sentry), basic analytics | 0.5 wk |

**Total: 6-10 weeks for one full-stack engineer working focused.** Can be parallelized with continued manual pilots so the build is shaped by real signal, not assumptions.

### Where you'd plug in

- **Code review of the existing MVP** — you decide whether to keep, refactor, or rewrite. If you'd rewrite, that's a real conversation about scope.
- **Technical leadership on the cross-company variant** — drive architectural decisions; I'm a willing collaborator but not the technical authority.
- **Production-readiness ownership** — auth, deploy, monitoring, security, GDPR. I have not done this work.
- **Continued evolution** — you set the technical direction. I bring product + customer signal.

### What I'd bring

- All the customer development from the manual pilots — every conversation, every reflection, every "this matched well" / "this didn't" learning.
- Product/UX intuition tested against real users.
- Sales motion, positioning, fundraising story.
- The legal and operational scaffolding (Airtable, Carrd, Calendly, FAQ, DPA template).

---

## Part 2 — Questions worth walking through together

These are the topics I'd want us to cover before either of us commits. Some of them will feel direct — that's intentional. Better to find disagreement now than 18 months in.

### Background and craft

1. Tell me about the last two things you've built. What were they, what scale, what was your role?
2. Greenfield project — what stack do you reach for, and why?
3. Show me a piece of code you're proud of. Then something you'd do differently in hindsight.
4. Have you worked at a pre-product-market-fit startup? What was that like?
5. How do you balance shipping fast vs building something that won't break in three months?

### Motivation and fit

6. Why MENT specifically? What about peer mentoring grabs you that another problem wouldn't?
7. Have you been in a role where an outside peer would've helped you get unstuck? What did you do instead?
8. What's *missing* from the plan as I've described it? What would you change before we did anything else?
9. What kind of company do you want this to become? Lifestyle business, venture-scale, something in between?

### Commitment and runway

10. What's your current situation? Employed, freelancing, between things, sabbatical?
11. When could you realistically start, and at what time commitment? Full-time, part-time, evenings?
12. How long can you afford to work on this without revenue? What's your financial floor?
13. Are you OK with the bright line that I'm full-time elsewhere until employer clearance, which means MENT moves slower than it could otherwise?

### Working style

14. Sync or async? Long deep-work blocks or short collaborative cycles?
15. What's your relationship with customer development? Do you want to be in user calls, or do you want to be left to build?
16. How do you handle disagreement when we don't agree on a technical or product call?
17. What does a great working week with a co-founder look like for you?

### Equity, IP, hard topics

18. What feels like a fair equity split given where we are? (Existing dev MVP, manual pilot kit, validation in motion vs your future contribution.)
19. Vesting and cliff — what's your starting position? (Mine: 4-year vest with 1-year cliff for both of us.)
20. What's a *bad outcome* clause we should write down now? (Examples: 6 months no validation signal, one of us leaves, an acqui-hire offer arrives, we lose alignment.)
21. Outside investors or bootstrap? At what stage do you think we should raise, if at all?
22. IP — anything you've worked on that overlaps with MENT's space and could be claimed by a former employer? (We need to know now, not later.)

### Validation specifically

23. What signal would convince *you* that the SME track works? What signal would convince you it doesn't?
24. What would you do for the first month if you started tomorrow?
25. What's the fastest experiment we could run in week 1 that's not on my plan?

### Reverse — questions for me

26. What would you want to ask me before deciding?

---

## Practical next steps if there's mutual interest

A reasonable runway to commitment:

1. **30-60-min first call** (this conversation guide).
2. **You spend 2-3 hours with the existing codebase** — make notes, draft what you'd keep / refactor / rewrite. We discuss your read.
3. **One paid weekend project together** (~1-2 days, paid by me at market rate) on a small scoped piece — e.g., adapt the existing matching algorithm for cross-company anti-competitor logic, or set up Render deployment with auth migration. Real working time together is the strongest signal.
4. **If both happy: a 30-day trial period** with a written-but-not-yet-vested equity grant, before signing a formal co-founder agreement with vesting.
5. **Formal co-founder agreement** with lawyer review on both sides.

---

*Prepared by {YOUR NAME} — {YOUR EMAIL} — {YOUR LINKEDIN}*
*Last updated: {DATE}*
