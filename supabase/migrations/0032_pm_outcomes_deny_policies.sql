-- The outcome ledger is function-only. Explicit deny policies document that
-- contract to Postgres and keep Supabase's RLS linter from flagging tables
-- with deliberately revoked client grants.
create policy outreach_targets_no_direct_access on public.outreach_targets
  as restrictive for all to authenticated using (false) with check (false);
create policy outcome_events_no_direct_access on public.outcome_events
  as restrictive for all to authenticated using (false) with check (false);
create policy continuation_intents_no_direct_access on public.continuation_intents
  as restrictive for all to authenticated using (false) with check (false);
