-- Two gaps in discovery_candidates, kept otherwise as written.
--
-- 1. career_history was stored and never read by matching. Past roles, employers
--    and what someone worked on are the richest unused signal in the schema, and
--    someone who did the work earlier still did it. The composed lines go to the
--    model; the atoms go to the grounding guard, which matches whole values and
--    would otherwise discard a correct citation of a previous role.
-- 2. The ranked list was cut at 100 against 216 eligible members, so a third of
--    the network was unreachable for any single query however relevant. Ranking
--    by relevance made the cut sensible rather than arbitrary, but it is still a
--    cut: raised to 250 so every eligible member is reachable at today's size.
create or replace function public.discovery_candidates(
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
      coalesce(h.experience, '[]'::jsonb) experience,
      coalesce(h.facts, '[]'::jsonb) experience_facts,
      ts_rank(
        setweight(to_tsvector('simple', concat_ws(' ', p.job_title, p.department, s.vocabulary)), 'A') ||
        setweight(to_tsvector('simple', concat_ws(' ', p.program, p.location, p.bio, h.vocabulary)), 'B'), q.terms
      ) relevance
    from public.profiles p cross join query q
    left join lateral (
      select jsonb_agg(skill order by lower(skill)) skills, string_agg(skill, ' ') vocabulary
      from public.skills where user_id = p.id and type = 'can_teach'
    ) s on true
    left join lateral (
      select jsonb_agg(line order by rn) experience,
             jsonb_agg(role_title order by rn) || coalesce(jsonb_agg(company order by rn) filter (where company is not null), '[]'::jsonb) facts,
             string_agg(concat_ws(' ', role_title, company, description), ' ') vocabulary
      from (
        select ch.role_title,
          nullif(btrim(coalesce(ch.company, '')), '') company,
          left(coalesce(ch.description, ''), 140) description,
          concat_ws(' ',
            case when nullif(btrim(coalesce(ch.company, '')), '') is null
              then ch.role_title else ch.role_title || ' at ' || btrim(ch.company) end,
            nullif('(' || concat_ws('-', ch.start_year, ch.end_year) || ')', '()'),
            nullif('- ' || left(btrim(coalesce(ch.description, '')), 140), '- ')
          ) line,
          row_number() over (
            order by coalesce(ch.end_year, 9999) desc, coalesce(ch.start_year, 0) desc, ch.id
          ) rn
        from public.career_history ch
        where ch.user_id = p.id and nullif(btrim(coalesce(ch.role_title, '')), '') is not null
      ) e
      where rn <= 3
    ) h on true
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
    select * from eligible order by relevance desc, lower(name), id limit 250
  )
  select coalesce(jsonb_agg(to_jsonb(r) - 'relevance' order by relevance desc, lower(name), id), '[]'::jsonb)
  from ranked r
$$;
