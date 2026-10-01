-- Rank the eligible network before bounding the model payload, not an arbitrary first page.
create function public.discovery_candidates(
  p_organization_id uuid, p_viewer_id uuid, p_query text,
  p_selected_id uuid default null
)
returns jsonb language sql stable security definer set search_path = public as $$
  with query as (
    select websearch_to_tsquery('simple', coalesce(string_agg(token, ' OR '), '')) terms
    from regexp_split_to_table(left(coalesce(p_query, ''), 2000), '[^[:alnum:]_]+') token
    where length(token) > 1
  ), eligible as (
    select p.id, p.name, p.job_title, p.department, p.program, p.cohort_year,
      p.location, p.seniority, p.tenure_years, p.bio, p.linkedin_headline,
      coalesce(s.skills, '[]'::jsonb) skills,
      ts_rank(
        setweight(to_tsvector('simple', concat_ws(' ', p.job_title, p.department, s.vocabulary)), 'A') ||
        setweight(to_tsvector('simple', concat_ws(' ', p.program, p.location, p.bio)), 'B'), q.terms
      ) relevance
    from public.profiles p cross join query q
    left join lateral (
      select jsonb_agg(skill order by lower(skill)) skills, string_agg(skill, ' ') vocabulary
      from public.skills where user_id = p.id and type = 'can_teach'
    ) s on true
    where p.organization_id = p_organization_id and p.id <> p_viewer_id
      and p.admin_scope = 'none' and p.onboarding_complete and p.deactivated_at is null
      and (p_selected_id is null or p.id = p_selected_id)
      and public.is_currently_available_mentor(p.id)
      and not exists (
        select 1 from public.sessions active where
          ((active.mentor_id = p.id and active.mentee_id = p_viewer_id)
            or (active.mentee_id = p.id and active.mentor_id = p_viewer_id))
          and (active.status = 'scheduled' or (active.status = 'pending'
            and (active.request_expires_at is null or active.request_expires_at > now())))
      )
  ), ranked as (
    select * from eligible order by relevance desc, lower(name), id limit 100
  )
  select coalesce(jsonb_agg(to_jsonb(r) - 'relevance' order by relevance desc, lower(name), id), '[]'::jsonb)
  from ranked r
$$;
revoke all on function public.discovery_candidates(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.discovery_candidates(uuid, uuid, text, uuid) to service_role;

create function public.discovery_network_coverage(p_organization_id uuid, p_viewer_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with members as materialized (
    select id, department, program, job_title from public.profiles
    where organization_id = p_organization_id and id <> p_viewer_id
      and admin_scope = 'none' and onboarding_complete and deactivated_at is null
  ), vocabulary as (
    select 'departments' kind, department value from members
    union select 'programs', program from members
    union select 'job_titles', job_title from members
    union select 'skills', s.skill from public.skills s join members m on m.id = s.user_id where s.type = 'can_teach'
  ), bounded as (
    select kind, left(trim(value), 80) value,
      row_number() over (partition by kind order by value) position
    from vocabulary where coalesce(trim(value), '') <> ''
  ), summaries as (
    select kind, jsonb_agg(value order by value) values from bounded
    where position <= case kind when 'job_titles' then 120 when 'skills' then 250 else 40 end
    group by kind
  )
  select jsonb_build_object('member_count', (select count(*) from members),
    'departments', coalesce((select values from summaries where kind = 'departments'), '[]'::jsonb),
    'programs', coalesce((select values from summaries where kind = 'programs'), '[]'::jsonb),
    'job_titles', coalesce((select values from summaries where kind = 'job_titles'), '[]'::jsonb),
    'skills', coalesce((select values from summaries where kind = 'skills'), '[]'::jsonb))
$$;
revoke all on function public.discovery_network_coverage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discovery_network_coverage(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
