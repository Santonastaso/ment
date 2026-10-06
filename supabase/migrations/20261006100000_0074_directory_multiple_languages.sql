create or replace function public.directory_browse(
  p_limit integer default 12, p_offset integer default 0, p_persona text default null,
  p_program text default null, p_cohort_year integer default null, p_location text default null,
  p_working_language text default null, p_query text default null, p_sort text default 'relevance'
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare viewer uuid := auth.uid(); viewer_org uuid; inter_org boolean; query_text text; result jsonb;
begin
  if viewer is null then raise exception 'auth_required'; end if;
  select p.organization_id, o.type = 'inter' into viewer_org, inter_org
    from public.profiles p join public.organizations o on o.id = p.organization_id
    where p.id = viewer and p.deactivated_at is null;
  if viewer_org is null then raise exception 'not_allowed'; end if;
  query_text := nullif(trim(coalesce(p_query, '')), '');
  if p_sort not in ('relevance', 'name') then raise exception 'invalid_sort'; end if;
  with eligible as (
    select p.*,
      to_tsvector('simple', concat_ws(' ', p.name, p.job_title, p.department, p.program, p.bio,
        (select string_agg(s.skill, ' ') from public.skills s where s.user_id = p.id and s.type = 'can_teach'))) search_document,
      (select count(*) from public.skills theirs join public.skills mine
        on lower(trim(mine.skill)) = lower(trim(theirs.skill)) and mine.user_id = viewer and mine.type = 'wants_to_learn'
        where theirs.user_id = p.id and theirs.type = 'can_teach') shared_skills
    from public.profiles p where p.organization_id = viewer_org and p.id <> viewer and p.admin_scope = 'none'
      and p.onboarding_complete and p.deactivated_at is null and public.is_currently_available_mentor(p.id)
  ), filtered as (
    select e.*, case when p_sort = 'name' then 0
      when query_text is null then shared_skills::real
      else ts_rank(search_document, websearch_to_tsquery('simple', query_text)) end relevance
    from eligible e
    where (p_persona is null or p_persona not in ('student', 'alumnus') or e.role = p_persona)
      and (p_program is null or e.program = p_program)
      and (p_cohort_year is null or e.cohort_year = p_cohort_year)
      and (p_location is null or e.location = p_location)
      and (p_working_language is null or e.working_language = any(string_to_array(p_working_language, ',')))
      and (query_text is null or search_document @@ websearch_to_tsquery('simple', query_text)
        or concat_ws(' ', e.name, e.job_title, e.department, e.program, e.bio) ilike '%' || query_text || '%'
        or exists (select 1 from public.skills s where s.user_id = e.id and s.type = 'can_teach' and s.skill ilike '%' || query_text || '%'))
  ), page as (
    select f.* from filtered f order by relevance desc, lower(name), id
    limit least(greatest(coalesce(p_limit, 12), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ), people_json as (
    select relevance, lower(pg.name) sort_name, pg.id, jsonb_build_object(
      'id', pg.id, 'name', case when inter_org then public.redacted_name(pg.name) else pg.name end,
      'role', pg.role, 'department', pg.department, 'program', pg.program, 'cohort_year', pg.cohort_year,
      'job_title', case when inter_org then null else pg.job_title end,
      'current_role', case when inter_org then null else pg.job_title end,
      'location', case when inter_org then null else pg.location end,
      'working_language', pg.working_language, 'bio', pg.bio, 'mentorship_available', true,
      'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', s.skill, 'type', s.type) order by lower(s.skill))
        from public.skills s where s.user_id = pg.id and s.type = 'can_teach'), '[]'::jsonb)
    ) item from page pg
  ), facets as (
    select
      (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct program v from eligible where coalesce(program, '') <> '') x) programs,
      (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct location v from eligible where coalesce(location, '') <> '') x) locations,
      (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct working_language v from eligible where working_language is not null) x) languages,
      (select coalesce(jsonb_agg(v order by v desc), '[]'::jsonb) from (select distinct cohort_year v from eligible where cohort_year is not null) x) cohort_years
  )
  select jsonb_build_object('total', (select count(*) from filtered)::int,
    'people', (select coalesce(jsonb_agg(item order by relevance desc, sort_name, id), '[]'::jsonb) from people_json),
    'facets', jsonb_build_object('programs', f.programs, 'locations', f.locations, 'languages', f.languages, 'cohortYears', f.cohort_years))
    into result from facets f;
  return result;
end;
$$;
revoke all on function public.directory_browse(integer, integer, text, text, integer, text, text, text, text) from public, anon;
grant execute on function public.directory_browse(integer, integer, text, text, integer, text, text, text, text) to authenticated;
notify pgrst, 'reload schema';
