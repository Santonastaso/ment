# Discovery Evaluation

The live discovery evaluation is manually dispatched from `main` and targets a separate
staging Supabase project. It uses a dedicated dummy account and publishes only
scenario outcomes as a seven-day Actions artifact; it must not target production
or emit individual match details.

Configure a GitHub environment named `staging-eval` with deployment branches
restricted to `main` and required reviewer approval. Add the following
environment secret and variables:

- Secret `SUPABASE_EVAL_ACCESS_TOKEN`: management token scoped to the staging project.
- Variable `SUPABASE_EVAL_PROJECT_REF`: staging project reference.
- Variable `SUPABASE_PRODUCTION_PROJECT_REF`: production project reference; the
  script fails closed if both references match.
- Variable `SUPABASE_EVAL_TEST_USER`: UUID of the dedicated staging test user.
- Variable `SUPABASE_EVAL_TEST_EMAIL`: that user's `@dummy.ment.io` address.

The evaluation does not run until this protected environment is configured.
