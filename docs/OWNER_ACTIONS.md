# Ment production owner actions

Everything below is an external account, credential, data, or policy decision. The application code is ready to consume these inputs and deliberately fails closed until they are supplied.

## Current checkout release note

- Not deployed: this checkout adds migration `0042_edge_rate_limits`, endpoint rate limits, failure telemetry, recent discovery history, and an organization-scoped AI diagnostics tab. Apply the migration and deploy the changed Edge Functions before relying on these controls in production.
- The discovery history delete action permanently removes the selected private search thread and its dependent feedback.

## 0. Supabase production project

- Completed: this checkout is linked to production project `vqvjdtnpcamyrqkqsrfb`.
- Completed: migrations `0038` through `0041` are applied and recorded remotely.
- Completed: `admin-create-invitation`, `accept-invitation`, `discovery-assistant`, `profile-ingest`, `reflection-classify`, and `calendar-provider` are active.
- Completed: linked database lint and unauthenticated endpoint smoke checks. The only remaining lint item is the intentional compatibility parameter `upsert_connection.p_status`.
- Completed: live authenticated smoke coverage for AI matching, grounded reasons, discovery persistence, lazy Profile loading, and browser errors.
- Pending: run the complete student/alumnus/admin regression suite after approved ESSEC staging data below is supplied.

## 1. Mistral

- Completed: production Mistral processing is enabled with `MISTRAL_API` and a funded model.
- Completed: `discovery-assistant`, `profile-ingest`, and `reflection-classify` are deployed.
- Completed: discovery persists private turns, asks clarifying questions, returns grounded match reasons, and records content-free run telemetry.
- Optional: set feature-specific model overrides listed in the README if quality testing supports different models.
- Pending owner review: run five representative school-approved prompts and sign off ranking and draft quality before opening broad access.
- Pending policy decision: ESCO identifiers remain unresolved for reflection suggestions. Do not send private reflection-derived terms to the public ESCO API without explicit approval; use an approved local taxonomy snapshot instead.

## 2. Google and Microsoft calendars

- Create a Google OAuth web application and a Microsoft Entra application.
- Register `https://YOUR_DOMAIN/calendar/callback` and the localhost callback for testing.
- Approve Google Calendar event scope and Microsoft `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `User.Read`, and `offline_access` scopes.
- Set Supabase secrets: `APP_ORIGIN`, `CALENDAR_TOKEN_ENCRYPTION_KEY` (a unique random value of at least 32 characters), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID`.
- Deploy `calendar-provider` and complete one Google and one Microsoft test booking.

## 3. ESSEC member data

- Provide an approved CSV/XLSX export containing at least: `name`, `email`, `program`, `cohort_year`, `persona`, `linkedin_url`, `linkedin_headline`, and a stable `external_id`/`essec_id`.
- Confirm the lawful basis, member notice, permitted fields, and refresh/deletion process before import.
- Supply at least 100 consented/authorized records. No synthetic people will be generated.
- Import first into a staging organization, spot-check ten profiles, then import/upsert production.

## 4. Invitations and email

- Set `APP_ORIGIN` to the production URL.
- Decide whether invitation links will be distributed manually or by email. Manual single-use links work now.
- If automated email is required, provide the approved sender domain and `RESEND_API_KEY`, then deploy/schedule `send-notification-outbox`.

## 5. Privacy, compliance, and operations

- Have counsel/controller approve the privacy notice, Terms, retention periods, and whether Iubenda will host the final legal text.
- Confirm whether Mistral receives profile/reflection content and document that processing in the privacy notice and records of processing.
- Decide invitation expiry, pending-request expiry (currently seven days), and default weekly/monthly call limits.
- Name the privacy contact and support contact shown to users.
- Create separate test accounts for student, alumnus, organization admin, and platform admin; do not test with production identities.

## Release gate

Do not announce general availability until migrations are applied, all Edge Functions are deployed, secrets are set, the ESSEC staging import is approved, and the build plus smoke checklist passes.
