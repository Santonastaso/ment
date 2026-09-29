# Client pilot release gate

This is a checklist, not a statement that production has passed. Run it on a
separate staging Supabase project with dedicated student, alumnus, and admin
accounts before inviting client users. Do not test destructive flows on live
member records.

## 1. Required configuration

- In Supabase staging and production, set `RESEND_API_KEY`,
  `NOTIFICATION_FROM_EMAIL` (a sender on a verified domain), and `APP_ORIGIN`
  (the HTTPS website origin, without a trailing slash). Email delivery fails
  closed if any are missing.
- In GitHub Actions secrets, set `SUPABASE_URL` and the legacy JWT
  `SUPABASE_SERVICE_ROLE_KEY` for the 15-minute notification dispatcher.
  Set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` for migrations and
  function deployment. Keep service-role credentials out of the client build.
- Populate real `profiles.notification_email` values for pilot identities using
  placeholder login addresses. Verify recipients before enabling dispatch.
- Configure the GitHub `production` environment with required reviewers.
  Vercel production deployment settings must be reviewed separately; the
  repository cannot enforce them.
- Leave the GitHub Actions variable `NOTIFICATIONS_ENABLED` unset until sender
  secrets and recipient addresses are verified. Set it to `true` only after a
  successful manual `notification-outbox` run to enable the 15-minute schedule.

## 2. Staging verification

1. Run `npm test`, `npm run check:migrations`, `npm run check:i18n`, and
   `npm run build`. Resolve remaining untranslated strings before a French or
   Italian client rollout; `check:i18n -- --strict-translations` reports all
   unchanged English and blank values.
2. Apply migrations to staging, deploy all Edge Functions, and trigger the
   `notification-outbox` workflow. Confirm one new request reaches the mentor,
   one acceptance reaches the requester, and both meeting participants receive
   one reminder. Confirm canceled or rescheduled meetings do not send an old
   reminder.
3. Test invitation, onboarding, discovery, request, acceptance, chat,
   scheduling, decline, capacity limits, and logout with dedicated accounts.
   Check both mobile and desktop, keyboard navigation, empty states, and error
   recovery. The current repository has unit and RLS smoke checks, not an
   automated full-journey test; record the results before promotion.
4. Decide whether `.ics` calendar invites are enough for the pilot. Google and
   Microsoft sync require their OAuth applications, scopes, and secrets.

## 3. Production promotion

1. Require a green CI run and approved member-data/privacy sign-off. Verify
   Supabase Auth redirects include the production domain and reset route.
2. Run `deploy-database` from `main`; confirm the new migration is recorded.
3. Run `supabase-functions` from `main`; function deploy is intentionally
   manual so code cannot arrive before its migration.
4. Trigger `notification-outbox` once and inspect sent/failed counts. Rows older
   than two days (seven for reflections) are marked failed rather than mailed.
   Investigate the pre-existing stale queue before setting `NOTIFICATIONS_ENABLED=true`.
5. Complete one real end-to-end student-to-alumnus journey on the production
   domain. Monitor the outbox, failed workflow runs, Edge Function errors, and
   client-side errors during the pilot.

## Still outside code

Approved ESSEC member data, verified notification addresses, sender-domain and
Resend credentials, calendar-provider decision/credentials, legal notice and
retention sign-off, staging accounts, and Vercel release controls require an
owner. Do not call the product client-ready until these have named owners and
the staging journey above passes.
