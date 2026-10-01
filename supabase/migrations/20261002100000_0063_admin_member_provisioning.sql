-- Keep profile and skill writes atomic, and allow admins to attach Auth-only
-- accounts created without an organization to the current organization.
create or replace function public.admin_auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.admin_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_auth_user_id_by_email(text) to service_role;

create or replace function public.admin_auth_users_by_email(p_emails text[])
returns table(email text, user_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  select lower(u.email), u.id
  from auth.users u
  where lower(u.email) = any(select lower(trim(address)) from unnest(p_emails) as addresses(address));
$$;

revoke all on function public.admin_auth_users_by_email(text[]) from public, anon, authenticated;
grant execute on function public.admin_auth_users_by_email(text[]) to service_role;

create or replace function public.admin_provision_member(
  p_user_id uuid,
  p_organization_id uuid,
  p_profile jsonb,
  p_skills jsonb default '{}'::jsonb,
  p_replace_skills boolean default false,
  p_allow_update boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.profiles%rowtype;
  v_skill text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'auth_user_missing'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then raise exception 'organization_missing'; end if;
  if jsonb_typeof(p_profile) <> 'object' then raise exception 'profile_invalid'; end if;
  if coalesce(p_profile->>'role', 'student') not in ('student', 'alumnus') then raise exception 'persona_invalid'; end if;

  select * into v_existing from public.profiles where id = p_user_id for update;
  if found then
    if not p_allow_update then raise exception 'member_profile_exists'; end if;
    if v_existing.admin_scope <> 'none' or v_existing.organization_id <> p_organization_id then
      raise exception 'member_scope_mismatch';
    end if;
    update public.profiles set
      name = coalesce(p_profile->>'name', ''),
      department = coalesce(p_profile->>'department', ''),
      seniority = case when p_profile->>'seniority' in ('junior','mid','senior','lead') then p_profile->>'seniority' else 'junior' end,
      job_title = coalesce(p_profile->>'job_title', ''),
      program = coalesce(p_profile->>'program', ''),
      cohort_year = nullif(p_profile->>'cohort_year', '')::int,
      role = coalesce(p_profile->>'role', 'student'),
      tenure_years = coalesce(nullif(p_profile->>'tenure_years', '')::int, 0),
      location = coalesce(p_profile->>'location', ''),
      linkedin_url = coalesce(p_profile->>'linkedin_url', ''),
      linkedin_headline = coalesce(p_profile->>'linkedin_headline', ''),
      external_source = nullif(p_profile->>'external_source', ''),
      external_id = nullif(p_profile->>'external_id', ''),
      source_synced_at = nullif(p_profile->>'source_synced_at', '')::timestamptz
    where id = p_user_id;
  else
    insert into public.profiles (
      id, name, department, seniority, job_title, program, cohort_year, role,
      tenure_years, location, linkedin_url, linkedin_headline, external_source,
      external_id, source_synced_at, onboarding_complete, organization_id,
      admin_scope, is_admin, must_change_password
    ) values (
      p_user_id, coalesce(p_profile->>'name', ''), coalesce(p_profile->>'department', ''),
      case when p_profile->>'seniority' in ('junior','mid','senior','lead') then p_profile->>'seniority' else 'junior' end,
      coalesce(p_profile->>'job_title', ''), coalesce(p_profile->>'program', ''),
      nullif(p_profile->>'cohort_year', '')::int, coalesce(p_profile->>'role', 'student'),
      coalesce(nullif(p_profile->>'tenure_years', '')::int, 0), coalesce(p_profile->>'location', ''),
      coalesce(p_profile->>'linkedin_url', ''), coalesce(p_profile->>'linkedin_headline', ''),
      nullif(p_profile->>'external_source', ''), nullif(p_profile->>'external_id', ''),
      nullif(p_profile->>'source_synced_at', '')::timestamptz,
      coalesce((p_profile->>'onboarding_complete')::boolean, false), p_organization_id,
      'none', false, coalesce((p_profile->>'must_change_password')::boolean, false)
    );
  end if;

  if p_replace_skills then
    delete from public.skills where user_id = p_user_id;
    for v_skill in select trim(skill) from jsonb_array_elements_text(coalesce(p_skills->'can_teach', '[]'::jsonb)) as skills(skill) loop
      if v_skill <> '' then insert into public.skills (user_id, skill, type) values (p_user_id, v_skill, 'can_teach'); end if;
    end loop;
    for v_skill in select trim(skill) from jsonb_array_elements_text(coalesce(p_skills->'wants_to_learn', '[]'::jsonb)) as skills(skill) loop
      if v_skill <> '' then insert into public.skills (user_id, skill, type) values (p_user_id, v_skill, 'wants_to_learn'); end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.admin_provision_member(uuid, uuid, jsonb, jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.admin_provision_member(uuid, uuid, jsonb, jsonb, boolean, boolean) to service_role;

-- Never let onboarding silently claim success for an Auth-only account.
create or replace function public.save_onboarding(
  p_name text, p_department text, p_seniority text, p_job_title text,
  p_bio text, p_shadow_role_response text, p_tenure_years int,
  p_location text, p_career jsonb, p_can_teach jsonb, p_wants_to_learn jsonb,
  p_program text default null, p_cohort_year int default null, p_persona text default null
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
  v_updated integer;
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
  get diagnostics v_updated = row_count;
  if v_updated = 0 then raise exception 'profile_missing'; end if;

  delete from public.career_history where user_id = v_caller;
  if p_career is not null and jsonb_typeof(p_career) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_career) loop
      if (v_entry->>'role_title') is not null and (v_entry->>'department') is not null then
        insert into public.career_history (
          user_id, role_title, department, company, description,
          start_year, start_month, end_year, end_month
        ) values (
          v_caller, v_entry->>'role_title', v_entry->>'department',
          coalesce(v_entry->>'company', ''), coalesce(v_entry->>'description', ''),
          (v_entry->>'start_year')::int, (v_entry->>'start_month')::int,
          (v_entry->>'end_year')::int, (v_entry->>'end_month')::int
        );
      end if;
    end loop;
  end if;

  delete from public.skills where user_id = v_caller;
  if p_can_teach is not null and jsonb_typeof(p_can_teach) = 'array' then
    for v_skill in select trim(jsonb_array_elements_text(p_can_teach)) loop
      if v_skill <> '' then insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'can_teach'); end if;
    end loop;
  end if;
  if p_wants_to_learn is not null and jsonb_typeof(p_wants_to_learn) = 'array' then
    for v_skill in select trim(jsonb_array_elements_text(p_wants_to_learn)) loop
      if v_skill <> '' then insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'wants_to_learn'); end if;
    end loop;
  end if;
  perform public.mark_matches_stale(v_caller);
end;
$$;

grant execute on function public.save_onboarding(
  text, text, text, text, text, text, int, text, jsonb, jsonb, jsonb, text, int, text
) to authenticated;
