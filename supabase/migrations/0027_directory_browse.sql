-- ============================================================================
-- 0027 — Wave 6: redacted directory browse RPC
--
-- One RPC powers both Explorer modes:
--   - chat-style: p_query keyword search (name / role / program / dept /
--     bio / skills), caller takes the first rows
--   - directory-style: real pagination + facet filters (persona, program,
--     cohort year, location, working language)
--
-- Privacy mirrors get_matches_for / peer_profile conventions:
--   - same-org members only, admins excluded, onboarding required
--   - inter-type org: name redacted, job_title/location withheld
--   - no match scores exposed (PM decision for the directory)
-- ============================================================================

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

  select coalesce(o.type, 'intra') into v_org_type
  from public.organizations o where o.id = v_viewer_org;
  v_inter := v_org_type = 'inter';

  v_q := nullif(trim(coalesce(p_query, '')), '');
  v_persona := case when p_persona in ('student', 'alumnus') then p_persona else null end;

  with eligible as (
    select p.*
    from public.profiles p
    where p.organization_id = v_viewer_org
      and p.id <> v_viewer
      and p.admin_scope = 'none'
      and p.onboarding_complete
      and p.deactivated_at is null
  ),
  filtered as (
    select e.*
    from eligible e
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
          where s.user_id = e.id and s.skill ilike '%' || v_q || '%'
        )
      )
  ),
  page as (
    select f.*
    from filtered f
    order by lower(f.name) asc, f.id asc
    limit least(greatest(coalesce(p_limit, 12), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  people_json as (
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
      'skills', coalesce((
        select jsonb_agg(jsonb_build_object('skill', s.skill, 'type', s.type) order by lower(s.skill))
        from public.skills s
        where s.user_id = pg.id and s.type = 'can_teach'
      ), '[]'::jsonb)
    ) as x
    from page pg
  ),
  facet_vals as (
    select
      (select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb)
         from (select distinct program as v from eligible where coalesce(program, '') <> '') t) as programs,
      (select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb)
         from (select distinct location as v from eligible where coalesce(location, '') <> '') t) as locations,
      (select coalesce(jsonb_agg(t.v order by t.v), '[]'::jsonb)
         from (select distinct working_language as v from eligible) t) as languages,
      (select coalesce(jsonb_agg(t.v order by t.v desc), '[]'::jsonb)
         from (select distinct cohort_year as v from eligible where cohort_year is not null) t) as cohort_years
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered)::int,
    'people', (select coalesce(jsonb_agg(x), '[]'::jsonb) from people_json),
    'facets', jsonb_build_object(
      'programs', fv.programs,
      'locations', fv.locations,
      'languages', fv.languages,
      'cohortYears', fv.cohort_years
    )
  )
  into v_result
  from facet_vals fv;

  return v_result;
end;
$function$;

grant execute on function public.directory_browse(integer, integer, text, text, integer, text, text, text) to authenticated;
