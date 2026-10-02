-- Coverage listed departments, programmes, job titles and skills, but not
-- locations. The clarify step uses coverage to decide whether a question could
-- change who comes back, so without locations it can never tell that nobody is
-- in the city being asked for: it asks anyway, then returns people elsewhere
-- labelled as matches. Locations are low cardinality (26 today) and already
-- shown on every directory card.
create or replace function public.discovery_network_coverage(p_organization_id uuid, p_viewer_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with members as materialized (
    select id, department, program, job_title, location from public.profiles
    where organization_id = p_organization_id and id <> p_viewer_id
      and admin_scope = 'none' and onboarding_complete and deactivated_at is null
  ), vocabulary as (
    select 'departments' kind, department value from members
    union select 'programs', program from members
    union select 'job_titles', job_title from members
    union select 'locations', location from members
    union select 'skills', s.skill from public.skills s join members m on m.id = s.user_id where s.type = 'can_teach'
  ), bounded as (
    select kind, left(trim(value), 80) value,
      row_number() over (partition by kind order by value) position
    from vocabulary where coalesce(trim(value), '') <> ''
  ), summaries as (
    select kind, jsonb_agg(value order by value) values from bounded
    where position <= case kind when 'job_titles' then 120 when 'skills' then 250 when 'locations' then 60 else 40 end
    group by kind
  )
  select jsonb_build_object('member_count', (select count(*) from members),
    'departments', coalesce((select values from summaries where kind = 'departments'), '[]'::jsonb),
    'programs', coalesce((select values from summaries where kind = 'programs'), '[]'::jsonb),
    'job_titles', coalesce((select values from summaries where kind = 'job_titles'), '[]'::jsonb),
    'locations', coalesce((select values from summaries where kind = 'locations'), '[]'::jsonb),
    'skills', coalesce((select values from summaries where kind = 'skills'), '[]'::jsonb))
$$;
notify pgrst, 'reload schema';
