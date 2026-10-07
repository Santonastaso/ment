-- Keep profile, career, skills and evidence in one transaction. A failed write
-- must not leave an account marked as onboarded.
drop function public.save_onboarding(
  text, text, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, integer, text
);

create function public.save_onboarding(
  p_name text, p_department text, p_seniority text, p_job_title text,
  p_bio text, p_shadow_role_response text, p_tenure_years integer,
  p_location text, p_career jsonb, p_can_teach jsonb, p_wants_to_learn jsonb,
  p_program text default null, p_cohort_year integer default null, p_persona text default null,
  p_linkedin_url text default null, p_linkedin_headline text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_entry jsonb;
  v_skill text;
  v_updated integer;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;

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
    linkedin_url = p_linkedin_url,
    linkedin_headline = p_linkedin_headline,
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
          (v_entry->>'start_year')::integer, (v_entry->>'start_month')::integer,
          (v_entry->>'end_year')::integer, (v_entry->>'end_month')::integer
        );
      end if;
    end loop;
  end if;

  delete from public.skills where user_id = v_caller;
  if p_can_teach is not null and jsonb_typeof(p_can_teach) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_can_teach) loop
      v_skill := trim(v_entry->>'skill');
      if v_skill <> '' then
        insert into public.skills (user_id, skill, type, example_project)
        values (v_caller, v_skill, 'can_teach', left(trim(coalesce(v_entry->>'example_project', '')), 80));
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

revoke all on function public.save_onboarding(
  text, text, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, integer, text, text, text
) from public, anon;
grant execute on function public.save_onboarding(
  text, text, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, integer, text, text, text
) to authenticated;
notify pgrst, 'reload schema';
