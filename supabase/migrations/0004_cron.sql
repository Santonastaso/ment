-- =====================================================================
-- Scheduled jobs (pg_cron). Idempotent: unschedule before re-creating.
-- =====================================================================

do $$
declare
  v_job record;
begin
  for v_job in select jobname from cron.job where jobname in ('mt-weekly-checkin','mt-nightly-rematch') loop
    perform cron.unschedule(v_job.jobname);
  end loop;
end $$;

-- Monday 09:00 UTC: nudge every active employee for a fresh reflection check-in
select cron.schedule(
  'mt-weekly-checkin',
  '0 9 * * MON',
  $$ update public.profiles set pending_checkin = true where not is_admin and deactivated_at is null $$
);

-- 03:15 UTC nightly: full rematch (belt-and-braces; row-level triggers also recompute)
select cron.schedule(
  'mt-nightly-rematch',
  '15 3 * * *',
  $$ select public.recompute_all_matches() $$
);
