-- 0025 Debounced matching (Wave 3)
--
-- Problem: every profile/skill/career write synchronously recomputed that
-- user's matches (O(N) pair evaluations), and the admin "Re-run matching"
-- button did a global delete + full O(N²) rebuild in one request — on hosted
-- PG this hits platform/gateway timeouts and surfaces as the "Re-run
-- matching" error.
--
-- Fix (PIT's debounce design):
--   1. profiles.matches_stale boolean — cheap dirty flag.
--   2. mark_matches_stale(uuid)       — sets the flag (self-service RPC +
--      internal helper). All write paths now call this instead of recomputing.
--   3. process_stale_matches(batch)   — cron worker: recomputes flagged users
--     (via _recompute_matches_for) in small batches, per-user exception
--     isolation, clears flags on success. Runs every 5 minutes.
--   4. admin_recompute_matches()      — now org-scoped and per-user batched
--     (platform admins cover all orgs); one bad user can't kill the run.
--   5. recompute_all_matches()        — no more global DELETE up front;
--     loops per-user instead (nightly cron keeps calling this name).
--   KEPT immediate: session completion still recomputes both participants
--   synchronously via _recompute_matches_for (0018 behavior, unchanged).
--
-- Backfill: flag everyone once so the first cron run rebuilds a consistent
-- match table under current logic.

-- ---------------------------------------------------------------------------
-- 1) Stale flag
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists matches_stale boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) Mark-stale helper.
--    No-arg / null-arg form flags the caller; explicit uuid form requires
--    an admin (or service/definer context). Security definer so it works
--    regardless of the column-grant allowlist (0012).
-- ---------------------------------------------------------------------------
create or replace function public.mark_matches_stale(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid := coalesce(p_user_id, auth.uid());
begin
  if v_target is null then raise exception 'auth_required'; end if;
  if p_user_id is not null and auth.uid() is not null
     and auth.uid() <> p_user_id and not public.is_admin(auth.uid()) then
    raise exception 'forbidden';
  end if;
  update public.profiles
  set matches_stale = true
  where id = v_target and admin_scope = 'none' and deactivated_at is null;
end;
$$;

grant execute on function public.mark_matches_stale(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Batched stale processor — the cron worker.
--    Per-user BEGIN/EXCEPTION: a failing user keeps its flag (retried next
--    run) without aborting the rest of the batch.
-- ---------------------------------------------------------------------------
create or replace function public.process_stale_matches(p_batch int default 100)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_done int := 0;
begin
  select array_agg(id) into v_ids
  from (
    select id from public.profiles
    where matches_stale and deactivated_at is null and admin_scope = 'none'
    order by id
    limit least(greatest(coalesce(p_batch, 100), 1), 500)
  ) q;
  if v_ids is null then return 0; end if;

  foreach v_id in array v_ids loop
    begin
      perform public._recompute_matches_for(v_id);
      update public.profiles set matches_stale = false where id = v_id;
      v_done := v_done + 1;
    exception when others then
      -- Leave flagged; retried on the next scheduled run.
      null;
    end;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.process_stale_matches(int) from public, anon, authenticated;
grant execute on function public.process_stale_matches(int) to service_role;

-- ---------------------------------------------------------------------------
-- 4) save_onboarding — same definition as 0024, but the final synchronous
--    recompute becomes a stale-flag set.
-- ---------------------------------------------------------------------------
create or replace function public.save_onboarding(
  p_name text,
  p_department text,
  p_seniority text,
  p_job_title text,
  p_bio text,
  p_shadow_role_response text,
  p_tenure_years int,
  p_location text,
  p_career jsonb,
  p_can_teach jsonb,
  p_wants_to_learn jsonb,
  p_program text default null,
  p_cohort_year int default null,
  p_persona text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_entry jsonb;
  v_skill text;
begin
  if v_caller is null then raise exception 'auth_required'; end if;

  update public.profiles set
    name = coalesce(p_name, name),
    department = coalesce(p_department, department),
    seniority = case when p_seniority in ('junior','mid','senior','lead') then p_seniority else seniority end,
    job_title = coalesce(p_job_title, job_title),
    bio = coalesce(p_bio, bio),
    shadow_role_response = coalesce(p_shadow_role_response, shadow_role_response),
    tenure_years = coalesce(p_tenure_years, tenure_years),
    location = coalesce(p_location, location),
    program = coalesce(p_program, program),
    cohort_year = coalesce(p_cohort_year, cohort_year),
    role = case when p_persona in ('student', 'alumnus') then p_persona else role end,
    onboarding_complete = true
  where id = v_caller;

  delete from public.career_history where user_id = v_caller;
  if p_career is not null and jsonb_typeof(p_career) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_career) loop
      if (v_entry->>'role_title') is not null and (v_entry->>'department') is not null then
        insert into public.career_history (
          user_id, role_title, department, company, description,
          start_year, start_month, end_year, end_month
        ) values (
          v_caller,
          v_entry->>'role_title',
          v_entry->>'department',
          coalesce(v_entry->>'company', ''),
          coalesce(v_entry->>'description', ''),
          (v_entry->>'start_year')::int,
          (v_entry->>'start_month')::int,
          (v_entry->>'end_year')::int,
          (v_entry->>'end_month')::int
        );
      end if;
    end loop;
  end if;

  delete from public.skills where user_id = v_caller;
  if p_can_teach is not null and jsonb_typeof(p_can_teach) = 'array' then
    for v_skill in select trim(jsonb_array_elements_text(p_can_teach)) loop
      if v_skill <> '' then
        insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'can_teach');
      end if;
    end loop;
  end if;
  if p_wants_to_learn is not null and jsonb_typeof(p_wants_to_learn) = 'array' then
    for v_skill in select trim(jsonb_array_elements_text(p_wants_to_learn)) loop
      if v_skill <> '' then
        insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'wants_to_learn');
      end if;
    end loop;
  end if;

  perform public.mark_matches_stale(v_caller);
end;
$$;

grant execute on function public.save_onboarding(
  text, text, text, text, text, text, int, text, jsonb, jsonb, jsonb,
  text, int, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) apply_reflection — same definition as 0002, recompute -> stale flag.
-- ---------------------------------------------------------------------------
create or replace function public.apply_reflection(
  p_reflection_id bigint,
  p_gaps jsonb default null,
  p_strengths jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_log public.reflection_logs;
  v_gaps jsonb;
  v_strengths jsonb;
  v_added int := 0;
  v_added_skills jsonb := '[]'::jsonb;
  v_skill text;
begin
  select * into v_log from public.reflection_logs where id = p_reflection_id and user_id = v_caller;
  if v_log.id is null then raise exception 'not_found'; end if;

  v_gaps := coalesce(p_gaps, v_log.extracted_gaps);
  v_strengths := coalesce(p_strengths, v_log.extracted_strengths);

  for v_skill in select trim(jsonb_array_elements_text(v_gaps)) loop
    if v_skill = '' then continue; end if;
    if not exists (
      select 1 from public.skills
      where user_id = v_caller and type = 'wants_to_learn'
        and lower(trim(skill)) = lower(v_skill)
    ) then
      insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'wants_to_learn');
      v_added := v_added + 1;
      v_added_skills := v_added_skills || jsonb_build_array(jsonb_build_object('skill', v_skill, 'type', 'wants_to_learn'));
    end if;
  end loop;

  for v_skill in select trim(jsonb_array_elements_text(v_strengths)) loop
    if v_skill = '' then continue; end if;
    if not exists (
      select 1 from public.skills
      where user_id = v_caller and type = 'can_teach'
        and lower(trim(skill)) = lower(v_skill)
    ) then
      insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'can_teach');
      v_added := v_added + 1;
      v_added_skills := v_added_skills || jsonb_build_array(jsonb_build_object('skill', v_skill, 'type', 'can_teach'));
    end if;
  end loop;

  update public.reflection_logs set applied = true where id = p_reflection_id;
  perform public.mark_matches_stale(v_caller);

  return jsonb_build_object('added', v_added, 'addedSkills', v_added_skills);
end;
$$;

grant execute on function public.apply_reflection(bigint, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) recompute_all_matches — per-user loop, no global DELETE, skip
--    deactivated rows. Nightly cron (mt-nightly-rematch) keeps calling this.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_all_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_total int := 0;
begin
  for v_user in
    select id from public.profiles
    where admin_scope = 'none' and deactivated_at is null
    order by id
  loop
    begin
      perform public._recompute_matches_for(v_user.id);
    exception when others then
      null;
    end;
  end loop;
  select count(*) into v_total from public.match_scores;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) admin_recompute_matches — the "Re-run matching" button.
--    Was: global DELETE + every user in every org inside one request (the
--    timeout behind the reported error). Now: caller's org only (platform
--    admins cover all orgs), per-user statements with error isolation.
-- ---------------------------------------------------------------------------
create or replace function public.admin_recompute_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
  v_user record;
  v_count int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  for v_user in
    select id from public.profiles
    where admin_scope = 'none'
      and deactivated_at is null
      and (v_platform or organization_id = v_org)
    order by id
  loop
    begin
      perform public._recompute_matches_for(v_user.id);
    exception when others then
      null;
    end;
  end loop;
  select count(*)::int into v_count
  from public.match_scores ms
  join public.profiles a on a.id = ms.user_a_id
  join public.profiles b on b.id = ms.user_b_id
  where v_platform or (a.organization_id = v_org and b.organization_id = v_org);
  return v_count;
end;
$$;

grant execute on function public.admin_recompute_matches() to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Cron: stale-match worker every 5 minutes. Nightly full rematch
--    (mt-nightly-rematch, 0004) is intentionally left untouched.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'mt-stale-matches',
  '*/5 * * * *',
  $$ select public.process_stale_matches(200) $$
);

-- ---------------------------------------------------------------------------
-- 9) One-time backfill: flag every active member so the next cron run
--    rebuilds the whole match table under current logic.
-- ---------------------------------------------------------------------------
update public.profiles set matches_stale = true
where admin_scope = 'none' and deactivated_at is null;
