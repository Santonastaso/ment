-- The admin dashboard shows groups and trends, never one person's activity.
--
-- 1. knowledge_graph: person nodes carry no name, job title, location or
--    seniority, and their ids are drawn fresh on every call, so nothing in the
--    response points back at a profile. A department with fewer than five
--    people in scope is sent blank and shown as "Other departments".
-- 2. admin_stats: "topMentors" (names and session counts) is replaced by
--    "departmentParticipation": members, active members, mentors who gave a
--    session and completed sessions, per department, with the same pooling.
--    deptActivity is pooled the same way.
-- 3. most_active_users, a ranking of named members, is removed.

create or replace function public.knowledge_graph(
  p_org uuid default null,
  p_language text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_scope text;
  v_caller_org uuid;
  v_org_filter uuid;
  v_lang text := nullif(trim(coalesce(p_language, '')), '');
  v_nodes jsonb;
  v_edges jsonb;
  v_orgs jsonb;
  v_langs jsonb;
  -- A fresh salt per call: person ids mean nothing outside this one response.
  v_salt text := gen_random_uuid()::text;
begin
  if v_caller is null then raise exception 'auth_required'; end if;

  v_scope := public.admin_scope_for(v_caller);
  if v_scope not in ('org', 'platform') then raise exception 'admin_only'; end if;

  select organization_id into v_caller_org from public.profiles where id = v_caller;

  -- Org scoping. Org admins are pinned to their own org regardless of the
  -- requested p_org; platform admins may target any org or null (all orgs).
  if v_scope = 'platform' then
    v_org_filter := p_org;
  else
    v_org_filter := v_caller_org;
  end if;

  -- 'all'/'any'/'*' are treated as "no language filter".
  if v_lang in ('all', 'any', '*') then v_lang := null; end if;

  with scoped as (
    select p.id, p.department, p.working_language, p.organization_id,
           p.program, p.cohort_year, p.role,
           coalesce(o.type, 'intra') as org_type,
           count(*) over (partition by p.organization_id, p.department) as department_size
    from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.admin_scope = 'none'
      and p.deactivated_at is null
      and (v_org_filter is null or p.organization_id = v_org_filter)
      and (v_lang is null or p.working_language = v_lang)
  ),
  people as (
    select s.*,
           'p:' || row_number() over (order by md5(s.id::text || v_salt)) as node_id,
           -- A department smaller than five would point at the few people in it.
           case when s.department_size >= 5 then nullif(s.department, '') end as group_department
    from scoped s
  ),
  person_nodes as (
    select jsonb_build_object(
      'id', pe.node_id,
      'kind', 'person',
      'department', pe.group_department,
      'working_language', pe.working_language,
      'program', pe.program,
      'cohort_year', pe.cohort_year,
      'role', pe.role,
      'org_id', pe.organization_id,
      'org_type', pe.org_type
    ) as node
    from people pe
  ),
  rels as (
    select pe.node_id,
           lower(trim(s.skill)) as skill_key,
           s.skill as skill_label,
           s.type
    from public.skills s
    join people pe on pe.id = s.user_id
    where coalesce(trim(s.skill), '') <> ''
  ),
  skill_nodes as (
    select jsonb_build_object(
      'id', 's:' || r.skill_key,
      'kind', 'skill',
      'label', min(r.skill_label),
      'teachers', count(*) filter (where r.type = 'can_teach'),
      'learners', count(*) filter (where r.type = 'wants_to_learn'),
      'degree', count(*)
    ) as node
    from rels r
    group by r.skill_key
  ),
  edges as (
    select jsonb_build_object(
      'source', r.node_id,
      'target', 's:' || r.skill_key,
      'type', r.type
    ) as edge
    from rels r
  ),
  real_edges as (
    select jsonb_build_object(
      'source', x.a,
      'target', x.b,
      'type', x.link_type,
      'weight', x.w
    ) as edge
    from (
      select least(pm.node_id, pn.node_id) as a,
             greatest(pm.node_id, pn.node_id) as b,
             'session' as link_type,
             count(*) as w
      from public.sessions s
      join people pm on pm.id = s.mentor_id
      join people pn on pn.id = s.mentee_id
      where s.status = 'completed'
        and s.mentor_id <> s.mentee_id
      group by 1, 2, 3
      union all
      select least(pr.node_id, pa.node_id),
             greatest(pr.node_id, pa.node_id),
             'connection',
             count(*)
      from public.connections c
      join people pr on pr.id = c.requester_id
      join people pa on pa.id = c.addressee_id
      where c.status = 'accepted'
        and c.requester_id <> c.addressee_id
      group by 1, 2, 3
    ) x
  )
  select
    (select coalesce(jsonb_agg(node), '[]'::jsonb)
       from (select node from person_nodes
             union all
             select node from skill_nodes) n),
    (select coalesce(jsonb_agg(edge), '[]'::jsonb)
       from (select edge from edges
             union all
             select edge from real_edges) e)
  into v_nodes, v_edges;

  -- Orgs the caller may scope the graph to (drives the company filter).
  if v_scope = 'platform' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'type', o.type) order by o.name), '[]'::jsonb)
    into v_orgs from public.organizations o;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'type', o.type)), '[]'::jsonb)
    into v_orgs from public.organizations o where o.id = v_caller_org;
  end if;

  -- Distinct working languages available in scope (drives the language filter).
  select coalesce(jsonb_agg(distinct working_language order by working_language), '[]'::jsonb)
  into v_langs
  from public.profiles
  where admin_scope = 'none'
    and deactivated_at is null
    and (v_scope = 'platform' or organization_id = v_caller_org);

  return jsonb_build_object(
    'nodes', v_nodes,
    'edges', v_edges,
    'meta', jsonb_build_object(
      'scope', v_scope,
      'callerOrg', v_caller_org,
      'orgFilter', v_org_filter,
      'language', v_lang,
      'organizations', v_orgs,
      'languages', v_langs
    )
  );
end;
$$;

revoke all on function public.knowledge_graph(uuid, text) from public;
grant execute on function public.knowledge_graph(uuid, text) to authenticated;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return (with members as (
    select p.id, p.onboarding_complete,
      case when count(*) over (partition by p.organization_id, p.department) >= 5
        then nullif(p.department, '') end as department
    from public.profiles p
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_platform or p.organization_id = v_org)
  ), activity as (
    select m.department, m.id,
      exists (select 1 from public.sessions s where m.id in (s.mentor_id, s.mentee_id)
        and s.status in ('scheduled', 'completed')) as active,
      exists (select 1 from public.sessions s where s.mentor_id = m.id and s.status = 'completed') as gave_session
    from members m
  ), completed as (
    select distinct m.department, s.id
    from members m join public.sessions s on m.id in (s.mentor_id, s.mentee_id) and s.status = 'completed'
  )
  select jsonb_build_object(
    'totalUsers', (select count(*) from members),
    'onboarded', (select count(*) from members where onboarding_complete),
    'onboardingRate', (select case when count(*) = 0 then 0
        else round(count(*) filter (where onboarding_complete) * 100.0 / count(*)) end from members),
    'totalMatches', (
      select count(*)
      from public.match_scores ms
      join public.profiles a on a.id = ms.user_a_id
      join public.profiles b on b.id = ms.user_b_id
      where v_platform or (a.organization_id = v_org and b.organization_id = v_org)
    ),
    'sessionsByStatus', coalesce(
      (select jsonb_agg(jsonb_build_object('status', status, 'cnt', cnt))
       from (
         select s.status, count(*)::int as cnt
         from public.sessions s
         join public.profiles m on m.id = s.mentor_id
         where v_platform or m.organization_id = v_org
         group by s.status
       ) s),
      '[]'::jsonb
    ),
    'departmentParticipation', coalesce(
      (select jsonb_agg(jsonb_build_object('department', department, 'members', members,
          'active_members', active_members, 'mentors_active', mentors_active)
          order by department is null, active_members * 1.0 / members desc, department)
       from (
         select department, count(*)::int members,
           count(*) filter (where active)::int active_members,
           count(*) filter (where gave_session)::int mentors_active
         from activity group by department
       ) d),
      '[]'::jsonb
    ),
    'deptActivity', coalesce(
      (select jsonb_agg(jsonb_build_object('department', department, 'session_count', session_count)
          order by session_count, department is null, department)
       from (
         select g.department, (select count(*) from completed c where c.department is not distinct from g.department)::int session_count
         from (select distinct department from members) g
       ) d),
      '[]'::jsonb
    )
  ));
end;
$$;

drop function if exists public.most_active_users(int);

notify pgrst, 'reload schema';
