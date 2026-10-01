# Tests and release gates

Run from the repository root on Node 24:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

`check` runs translation/migration checks, unit/database/agent regressions and
the production build. `test:browser` starts and stops its own Vite server on
port 3010. It tests real routing and screens with isolated auth/API fixtures:
onboarding, discovery, request, acceptance, messages, scheduling, private
feedback, groups, unread counts, mobile back navigation and send failures.
External service calls are blocked; no live users, email or production writes.
These browser tests verify the frontend contract, not a live Supabase journey.
Database migration replay and production RLS checks remain separate CI gates.

CI runs these checks under `build`, along with `gitleaks`, `database` and
`changed-functions`. Require those four checks and pull requests on `main`.
Do not require `release-supabase` before merging: it runs after the merge and
is Vercel's production deployment gate. No second deployment pipeline.
Browser failures save screenshots and traces as a 7-day CI artifact.

## Agent owner workflow

```sh
npm run test:ai
npm run eval:ai
```

`test:ai` is deterministic and included in every `npm run check`. It executes
the real discovery handler, prompts, Mistral adapter and output guards against
synthetic data and fixture model replies. It protects the integration contract;
it does not prove that a real model obeys a prompt.

`eval:ai` explicitly calls Mistral using the same handler and synthetic data.
Set `MISTRAL_API` (or `MISTRAL_API_KEY`) and `MISTRAL_MODEL` in the process
environment, matching the deployment. Feature-specific `MISTRAL_MODEL_DISCOVERY_*`
overrides are honored. Never commit credentials or paste them into a PR.
Seven scenarios check language, goal replacement, the clarification limit,
direct matching and honest empty results. Each provider call has a 30-second
timeout. This small paid/non-deterministic suite is opt-in, not a PR gate.

After model/prompt changes, the agent owner runs both suites and records the
model name and pass/fail summary in the PR. Application prompts are not duplicated
in test fixtures. Add a failing regression case for each user-reported bug.
