# Repository Guide

- Install from the lockfiles with `npm ci`; run the app with `npm run dev`.
- Run `npm run check` before opening a pull request.
- Make every database change in a new Supabase migration. Preserve RLS and test with dedicated accounts.
- Keep service credentials out of client code, logs, prompts, and fixtures.
- Preserve the configured production release gate. Production migrations and function deployment run through GitHub Actions.

## Code Review Rules

- Prioritize auth and RLS bypasses, exposure of member data, unsafe migrations, and broken onboarding or messaging flows.
- For agent or prompt changes, check that the configured website language is respected and that a new user request can replace an earlier goal.
- Report only actionable findings with a concrete failure path and severity.
