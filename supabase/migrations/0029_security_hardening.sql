-- 0029 Security hardening and response contracts
--
-- Keep profile writes explicit at the column privilege layer, redact session
-- mutation responses, and scope uploaded files to the caller's own prefix.

-- ---------------------------------------------------------------------------
-- Profile writes: direct clients may edit only self-service fields.
-- SECURITY DEFINER RPCs and service-role functions retain their owner rights.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (
  department, seniority, job_title, tenure_years, location, bio,
  shadow_role_response,
  mentorship_paused, mentorship_unavailable_until, mentorship_note,
  program, cohort_year, monthly_session_goal, reflection_email_reminders
) on public.profiles to authenticated;

-- The old trigger tried to distinguish direct DML by current_user, but a
-- SECURITY DEFINER trigger always sees its function owner. Column privileges
-- above are the reliable boundary; keep the trigger as a no-op for legacy
-- trigger compatibility.
create or replace function public.guard_profile_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

-- Auth metadata is user-controlled during direct signup. Never derive admin
-- scope or organization membership from it. Trusted provisioning functions
-- set those fields explicitly after creation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, name, department, seniority, job_title, tenure_years, location,
    must_change_password, is_admin, admin_scope, organization_id, onboarding_complete
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'department', ''),
    case when new.raw_user_meta_data->>'seniority' in ('junior','mid','senior','lead')
      then new.raw_user_meta_data->>'seniority' else 'junior' end,
    coalesce(new.raw_user_meta_data->>'job_title', ''),
    coalesce((new.raw_user_meta_data->>'tenure_years')::int, 0),
    coalesce(new.raw_user_meta_data->>'location', ''),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false),
    false,
    'none',
    '00000000-0000-0000-0000-000000000001'::uuid,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Uploaded objects are private to the creating admin/user, including the
-- imports bucket. Functions also validate the prefix before using service
-- role access.
drop policy if exists imports_admin on storage.objects;
create policy imports_admin on storage.objects
for all to authenticated
using (
  bucket_id = 'imports'
  and public.is_admin(auth.uid())
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'imports'
  and public.is_admin(auth.uid())
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- Connection creation can only create a pending request for a real peer.
-- Acceptance remains addressee-only in the function below.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_connection(
  p_addressee_id uuid,
  p_status text default 'pending'
)
returns public.connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_org uuid;
  v_conn public.connections;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if v_caller = p_addressee_id then raise exception 'cannot_connect_self'; end if;
  select organization_id into v_caller_org from public.profiles where id = v_caller;
  if not exists (
    select 1 from public.profiles
    where id = p_addressee_id
      and organization_id = v_caller_org
      and admin_scope = 'none'
      and onboarding_complete
      and deactivated_at is null
  ) then raise exception 'user_not_found'; end if;

  insert into public.connections (requester_id, addressee_id, status)
  values (v_caller, p_addressee_id, 'pending')
  on conflict (requester_id, addressee_id)
  do update set status = case
    when public.connections.status = 'accepted' then 'accepted'
    else 'pending'
  end
  returning * into v_conn;
  return v_conn;
end;
$$;

create or replace function public.update_connection_status(p_id bigint, p_status text)
returns public.connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_status not in ('accepted','declined') then raise exception 'invalid_status'; end if;
  select * into v_conn from public.connections where id = p_id for update;
  if v_conn.id is null then raise exception 'not_found'; end if;
  if v_caller <> v_conn.addressee_id then raise exception 'forbidden'; end if;
  update public.connections set status = p_status where id = p_id returning * into v_conn;
  return v_conn;
end;
$$;

-- Directory search must never use private wants-to-learn skills as an
-- identifying search index.
create or replace function public.directory_browse(
  p_limit integer default 12,
  p_offset integer default 0,
  p_persona text default null,
  p_program text default null,
  p_cohort_year integer default null,
  p_location text default null,
  p_working_language text default null,
  p_query text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_viewer uuid := auth.uid();
  v_viewer_org uuid;
  v_org_type text;
  v_inter boolean;
  v_q text;
  v_persona text;
  v_result jsonb;
begin
  if v_viewer is null then raise exception 'auth_required'; end if;
  select organization_id into v_viewer_org from public.profiles where id = v_viewer;
  select coalesce(o.type, 'intra') into v_org_type from public.organizations o where o.id = v_viewer_org;
  v_inter := v_org_type = 'inter';
  v_q := nullif(trim(coalesce(p_query, '')), '');
  v_persona := case when p_persona in ('student', 'alumnus') then p_persona else null end;

  with eligible as (
    select p.* from public.profiles p
    where p.organization_id = v_viewer_org and p.id <> v_viewer
      and p.admin_scope = 'none' and p.onboarding_complete and p.deactivated_at is null
  ), filtered as (
    select e.* from eligible e
    where (v_persona is null or e.role = v_persona)
      and (p_program is null or e.program = p_program)
      and (p_cohort_year is null or e.cohort_year = p_cohort_year)
      and (p_location is null or e.location = p_location)
      and (p_working_language is null or e.working_language = p_working_language)
      and (
        v_q is null
        or e.name ilike '%' || v_q || '%'
        or coalesce(e.job_title, '') ilike '%' || v_q || '%'
        or coalesce(e.program, '') ilike '%' || v_q || '%'
        or coalesce(e.department, '') ilike '%' || v_q || '%'
        or coalesce(e.bio, '') ilike '%' || v_q || '%'
        or exists (
          select 1 from public.skills s
          where s.user_id = e.id and s.type = 'can_teach' and s.skill ilike '%' || v_q || '%'
        )
      )
  ), page as (
    select f.* from filtered f
    order by lower(f.name), f.id
    limit least(greatest(coalesce(p_limit, 12), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  ), people_json as (
    select jsonb_build_object(
      'id', pg.id,
      'name', case when v_inter then public.redacted_name(pg.name) else pg.name end,
      'role', pg.role,
      'department', pg.department,
      'program', pg.program,
      'cohort_year', pg.cohort_year,
      'job_title', case when v_inter then null else pg.job_title end,
      'current_role', case when v_inter then null else pg.job_title end,
      'location', case when v_inter then null else pg.location end,
      'working_language', pg.working_language,
      'bio', pg.bio,
      'mentorship_available', public.is_currently_available_mentor(pg.id),
      'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', s.skill, 'type', s.type) order by lower(s.skill))
        from public.skills s where s.user_id = pg.id and s.type = 'can_teach'), '[]'::jsonb)
    ) as x from page pg
  ), facet_vals as (
    select
      (select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb) from (select distinct program as v from eligible where coalesce(program, '') <> '') t) as programs,
      (select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb) from (select distinct location as v from eligible where coalesce(location, '') <> '') t) as locations,
      (select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb) from (select distinct working_language as v from eligible) t) as languages,
      (select coalesce(jsonb_agg(t.v order by t.v desc), '[]'::jsonb) from (select distinct cohort_year as v from eligible where cohort_year is not null) t) as cohort_years
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered)::int,
    'people', (select coalesce(jsonb_agg(x), '[]'::jsonb) from people_json),
    'facets', jsonb_build_object('programs', fv.programs, 'locations', fv.locations, 'languages', fv.languages, 'cohortYears', fv.cohort_years)
  ) into v_result from facet_vals fv;
  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Session mutation RPCs return the same role-redacted payload as reads.
-- ---------------------------------------------------------------------------
drop function if exists public.update_session_feedback(bigint, text, int);
create function public.update_session_feedback(
  p_session_id bigint, p_reflection text default null, p_rating int default null
)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then raise exception 'forbidden'; end if;
  if v_caller = v_session.mentor_id then
    update public.sessions set
      mentor_reflection = coalesce(p_reflection, mentor_reflection),
      mentor_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentor_rating)
    where id = p_session_id;
  else
    update public.sessions set
      reflection = coalesce(p_reflection, reflection),
      mentee_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentee_rating)
    where id = p_session_id;
  end if;
  select * into v_session from public.sessions where id = p_session_id;
  return public.session_payload(v_session, v_caller);
end;
$function$;
grant execute on function public.update_session_feedback(bigint, text, int) to authenticated;

drop function if exists public.complete_session(bigint, text, integer);
create function public.complete_session(
  p_session_id bigint, p_reflection text default null, p_rating integer default null
)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
  v_both boolean;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then raise exception 'forbidden'; end if;
  if v_caller = v_session.mentor_id then
    update public.sessions set mentor_completed_at = now(),
      mentor_reflection = coalesce(p_reflection, mentor_reflection),
      mentor_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentor_rating)
      where id = p_session_id;
  else
    update public.sessions set mentee_completed_at = now(),
      reflection = coalesce(p_reflection, reflection),
      mentee_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentee_rating)
      where id = p_session_id;
  end if;
  select mentor_completed_at is not null and mentee_completed_at is not null into v_both
    from public.sessions where id = p_session_id;
  if v_both then
    update public.sessions set status = 'completed' where id = p_session_id;
    perform public._recompute_matches_for(v_session.mentor_id);
    perform public._recompute_matches_for(v_session.mentee_id);
  end if;
  select * into v_session from public.sessions where id = p_session_id;
  return public.session_payload(v_session, v_caller);
end;
$function$;
grant execute on function public.complete_session(bigint, text, integer) to authenticated;

-- The remaining session mutations also return redacted payloads. Drop/recreate
-- is required because PostgreSQL cannot change a function return type in place.
drop function if exists public.request_session(uuid, text, timestamptz, int, text, jsonb);
create function public.request_session(
  p_mentor_id uuid, p_title text, p_scheduled_at timestamptz default null,
  p_duration_minutes int default 60, p_pre_session_question text default null,
  p_topics jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare
  v_caller uuid := auth.uid();
  v_caller_org uuid;
  v_mentor public.profiles;
  v_topics jsonb;
  v_session public.sessions;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_mentor_id is null or p_mentor_id = v_caller then raise exception 'mentor_required'; end if;
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'title_required'; end if;
  select organization_id into v_caller_org from public.profiles where id = v_caller;
  select * into v_mentor from public.profiles where id = p_mentor_id;
  if v_mentor.id is null or v_mentor.deactivated_at is not null
     or v_mentor.organization_id <> v_caller_org then raise exception 'mentor_not_available'; end if;
  if not public.is_currently_available_mentor(p_mentor_id) then raise exception 'mentor_paused'; end if;
  if exists (select 1 from public.sessions s where s.status in ('pending','scheduled')
    and ((s.mentor_id = p_mentor_id and s.mentee_id = v_caller)
      or (s.mentor_id = v_caller and s.mentee_id = p_mentor_id))) then
    raise exception 'active_session_exists';
  end if;
  v_topics := coalesce(p_topics, '[]'::jsonb);
  if jsonb_typeof(v_topics) <> 'array' then v_topics := '[]'::jsonb; end if;
  insert into public.sessions
    (mentor_id, mentee_id, title, scheduled_at, duration_minutes, pre_session_question, topics, status)
  values (p_mentor_id, v_caller, trim(p_title), p_scheduled_at,
    least(greatest(coalesce(p_duration_minutes, 60), 15), 240),
    left(coalesce(p_pre_session_question, ''), 500), v_topics, 'pending')
  returning * into v_session;
  return public.session_payload(v_session, v_caller);
end;
$function$;
grant execute on function public.request_session(uuid, text, timestamptz, int, text, jsonb) to authenticated;

drop function if exists public.accept_session(bigint, timestamptz);
create function public.accept_session(p_session_id bigint, p_scheduled_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare v_caller uuid := auth.uid(); v_session public.sessions;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_session.mentor_id <> v_caller or v_session.status <> 'pending' then raise exception 'forbidden'; end if;
  update public.sessions set status = 'scheduled', scheduled_at = coalesce(p_scheduled_at, scheduled_at)
    where id = p_session_id returning * into v_session;
  return public.session_payload(v_session, v_caller);
end;
$function$;
grant execute on function public.accept_session(bigint, timestamptz) to authenticated;

drop function if exists public.cancel_session(bigint, text);
create function public.cancel_session(p_session_id bigint, p_status text default 'cancelled')
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare v_caller uuid := auth.uid(); v_session public.sessions;
begin
  if p_status not in ('declined','cancelled') then raise exception 'invalid_status'; end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then raise exception 'forbidden'; end if;
  update public.sessions set status = p_status where id = p_session_id returning * into v_session;
  return public.session_payload(v_session, v_caller);
end;
$function$;
grant execute on function public.cancel_session(bigint, text) to authenticated;

drop function if exists public.reschedule_session(bigint, timestamptz);
create function public.reschedule_session(p_session_id bigint, p_scheduled_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare v_caller uuid := auth.uid(); v_session public.sessions;
begin
  if p_scheduled_at is null or p_scheduled_at <= now() then raise exception 'invalid_schedule'; end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then raise exception 'forbidden'; end if;
  update public.sessions set scheduled_at = p_scheduled_at where id = p_session_id returning * into v_session;
  return public.session_payload(v_session, v_caller);
end;
$function$;
grant execute on function public.reschedule_session(bigint, timestamptz) to authenticated;

-- Notification records are service-only; the mailer is the sole reader.
alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('queued','sending','sent','failed'));
alter table public.notification_outbox add column if not exists claimed_at timestamptz;
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- Admin rematching only marks the scoped population. The existing cron worker
-- consumes bounded batches, so the button no longer holds one request open for
-- an entire quadratic rebuild.
create or replace function public.admin_start_rematch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(v_caller);
  v_platform boolean := public.is_platform_admin(v_caller);
  v_count integer;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  update public.profiles
  set matches_stale = true
  where admin_scope = 'none' and deactivated_at is null
    and (v_platform or organization_id = v_org);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.admin_start_rematch() to authenticated;
