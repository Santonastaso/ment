-- Authenticated directory access remains useful for normal browsing, but a
-- member cannot automate high-volume extraction. The event table is private,
-- contains no search text or viewed profile data, and is purged after 48h.
create table public.directory_access_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
create index directory_access_events_user_time_idx on public.directory_access_events(user_id, requested_at desc);
create index directory_access_events_expiry_idx on public.directory_access_events(requested_at);
alter table public.directory_access_events enable row level security;
revoke all on public.directory_access_events from public, anon, authenticated;
grant all on public.directory_access_events to service_role;

create function public.purge_directory_access_events()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare purged integer;
begin
  delete from public.directory_access_events where requested_at < now() - interval '48 hours';
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke all on function public.purge_directory_access_events() from public, anon, authenticated;
grant execute on function public.purge_directory_access_events() to service_role;

-- Production has pg_cron. Keep local/test databases without the extension valid.
do $$
begin
  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''mt-directory-access-retention''';
    execute 'select cron.schedule(''mt-directory-access-retention'', ''17 3 * * *'', ''select public.purge_directory_access_events()'')';
  end if;
exception when undefined_table or undefined_function or invalid_schema_name then
  null;
end;
$$;

create function public.enforce_directory_access_limit()
returns void language plpgsql volatile security definer set search_path = public as $$
declare viewer uuid := auth.uid(); recent_minute integer; recent_day integer;
begin
  if viewer is null then raise exception 'auth_required'; end if;
  perform pg_advisory_xact_lock(hashtext(viewer::text));
  delete from public.directory_access_events where user_id = viewer and requested_at < now() - interval '48 hours';
  select count(*) filter (where requested_at >= now() - interval '1 minute'), count(*)
    into recent_minute, recent_day from public.directory_access_events
    where user_id = viewer and requested_at >= now() - interval '24 hours';
  if recent_minute >= 30 or recent_day >= 400 then raise exception 'rate_limited'; end if;
  insert into public.directory_access_events(user_id) values (viewer);
end;
$$;

alter function public.directory_browse(integer, integer, text, text, integer, text, text, text, text)
  rename to directory_browse_unthrottled;
revoke all on function public.directory_browse_unthrottled(integer, integer, text, text, integer, text, text, text, text)
  from public, anon, authenticated;

create function public.directory_browse(
  p_limit integer default 12, p_offset integer default 0, p_persona text default null,
  p_program text default null, p_cohort_year integer default null, p_location text default null,
  p_working_language text default null, p_query text default null, p_sort text default 'relevance'
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.enforce_directory_access_limit();
  return public.directory_browse_unthrottled(p_limit, p_offset, p_persona, p_program,
    p_cohort_year, p_location, p_working_language, p_query, p_sort);
end;
$$;

revoke all on function public.enforce_directory_access_limit(),
  public.directory_browse(integer, integer, text, text, integer, text, text, text, text) from public, anon;
revoke all on function public.enforce_directory_access_limit() from authenticated;
grant execute on function public.directory_browse(integer, integer, text, text, integer, text, text, text, text)
  to authenticated;
notify pgrst, 'reload schema';
