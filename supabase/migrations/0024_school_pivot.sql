-- 0024 School pivot (Wave 1)
--
-- 1. profiles.program / profiles.cohort_year ("class of") — minimum school info.
-- 2. Guard rewrite FIRST (the role pivot below must pass through it):
--    - name lock: users can no longer change their own name (PM request)
--    - security-definer fix: RPCs like save_onboarding / admin_set_role /
--      admin_deactivate run as the function owner, so `current_user` is NOT
--      'authenticated' there. The previous guard only checked auth.role() and
--      therefore rejected those legitimate writes (and blocked this very
--      migration's UPDATE); we now trust definer/postgres contexts explicitly.
-- 3. Role pivot: `role` becomes the client-facing persona (student | alumnus).
--    Permissions stay on admin_scope; team_lead/manager/employee are retired
--    along with the Team Insights feature.
-- 4. Drop the Team Insights RPCs (feature removed).

-- ---------------------------------------------------------------------------
-- 1) Program + cohort year
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists program text not null default '',
  add column if not exists cohort_year int;

-- ---------------------------------------------------------------------------
-- 2) Guard rewrite: name lock + security-definer bypass fix
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role (Edge Functions, CSV import) bypasses the guard.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  -- Updates fired from inside other triggers are trusted.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  -- Security-definer RPCs (save_onboarding, admin_set_role, admin_deactivate,
  -- ...) execute as their owner (postgres), while direct PostgREST writes run
  -- as role 'authenticated'. Trust the former, police the latter. This also
  -- unblocks admin RPCs that update protected columns.
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- Direct self-service writes may never touch identity/org/role columns —
  -- and since 0024, never the user's own name either.
  if new.name is distinct from old.name
     or new.is_admin is distinct from old.is_admin
     or new.admin_scope is distinct from old.admin_scope
     or new.organization_id is distinct from old.organization_id
     or new.manager_id is distinct from old.manager_id
     or new.role is distinct from old.role
     or new.deactivated_at is distinct from old.deactivated_at then
    raise exception 'protected_columns: name and admin/org/role columns can only be changed by admins or the system';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Role pivot (now passes through the rewritten guard)
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'student';

alter table public.profiles
  alter column role set default 'student',
  add constraint profiles_role_check check (role in ('student', 'alumnus'));

-- ---------------------------------------------------------------------------
-- 4) Drop Team Insights RPCs
-- ---------------------------------------------------------------------------
drop function if exists public.team_skill_gaps(uuid);
drop function if exists public.team_report_ids(uuid);

-- ---------------------------------------------------------------------------
-- 5) save_onboarding: accept program / cohort year / persona
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

  perform public.recompute_matches_for(v_caller);
end;
$$;

-- Drop the legacy 11-arg overload and re-grant the new signature.
drop function if exists public.save_onboarding(
  text, text, text, text, text, text, int, text, jsonb, jsonb, jsonb
);

grant execute on function public.save_onboarding(
  text, text, text, text, text, text, int, text, jsonb, jsonb, jsonb,
  text, int, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) admin_set_role: now sets the persona (student | alumnus)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if p_user_id = v_caller then raise exception 'cannot_set_self'; end if;
  if not public.can_manage_profile(p_user_id) then raise exception 'forbidden'; end if;
  if p_role not in ('student', 'alumnus') then raise exception 'invalid_role'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and admin_scope <> 'none') then
    raise exception 'cannot_role_admin';
  end if;
  update public.profiles set role = p_role where id = p_user_id and public.can_manage_profile(id);
end;
$function$;

grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) peer_profile: expose program / cohort year / persona on peer cards
--    (same definition as 0020 plus the three new fields)
-- ---------------------------------------------------------------------------
create or replace function public.peer_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_viewer uuid := auth.uid();
  v_viewer_org uuid;
  v_target public.profiles;
  v_skills jsonb;
  v_progress jsonb;
  v_badges jsonb;
  v_signature jsonb;
  v_available boolean;
  v_org_type text;
  v_inter boolean;
begin
  if v_viewer is null then raise exception 'auth_required'; end if;
  select organization_id into v_viewer_org from public.profiles where id = v_viewer;
  select * into v_target from public.profiles where id = p_user_id;
  if v_target.id is null or v_target.deactivated_at is not null then raise exception 'not_found'; end if;
  if v_target.organization_id <> v_viewer_org and not public.is_platform_admin(v_viewer) then
    raise exception 'not_found';
  end if;

  select coalesce(o.type, 'intra') into v_org_type
  from public.organizations o where o.id = v_viewer_org;
  v_inter := v_org_type = 'inter';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'user_id', user_id, 'skill', skill, 'type', type, 'example_project', example_project
  ) order by lower(skill)), '[]'::jsonb)
  into v_skills
  from public.skills
  where user_id = p_user_id and type = 'can_teach';

  select coalesce(jsonb_agg(to_jsonb(sp) order by lower(sp.skill)), '[]'::jsonb)
  into v_progress
  from public.skill_progress_for(p_user_id) sp
  where sp.type = 'can_teach';

  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
  into v_badges
  from public.badges_for(p_user_id) b;

  select coalesce(jsonb_agg(skill order by skill), '[]'::jsonb)
  into v_signature
  from public.expertise_signature_for(p_user_id);

  v_available := public.is_currently_available_mentor(p_user_id);

  return jsonb_build_object(
    'id', v_target.id,
    'name', case when v_inter then public.redacted_name(v_target.name) else v_target.name end,
    'department', v_target.department,
    'seniority', v_target.seniority,
    'job_title', case when v_inter then null else v_target.job_title end,
    'current_role', case when v_inter then null else v_target.job_title end,
    'location', case when v_inter then null else v_target.location end,
    'program', v_target.program,
    'cohort_year', v_target.cohort_year,
    'role', v_target.role,
    'bio', v_target.bio,
    'skills', v_skills,
    'skillProgress', v_progress,
    'expertiseSignature', v_signature,
    'badges', v_badges,
    'career', '[]'::jsonb,
    'direct_reports', 0,
    'is_admin', false,
    'mentorship_paused', v_target.mentorship_paused,
    'mentorship_unavailable_until', v_target.mentorship_unavailable_until,
    'mentorship_available', v_available,
    'org_type', v_org_type
  );
end;
$function$;
