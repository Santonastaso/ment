-- Admin reporting uses aggregates only. No member-level graph nodes or edges
-- leave the database, and cells below five are suppressed.

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
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  v_scope := public.admin_scope_for(v_caller);
  if v_scope not in ('org', 'platform') then raise exception 'admin_only'; end if;
  select organization_id into v_caller_org from public.profiles where id = v_caller;
  v_org_filter := case when v_scope = 'platform' then p_org else v_caller_org end;
  if v_lang in ('all', 'any', '*') then v_lang := null; end if;

  with scoped as (
    select p.id, p.organization_id,
      coalesce(nullif(trim(p.department), ''), 'Other departments') as raw_department,
      coalesce(o.type, 'intra') as org_type
    from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_org_filter is null or p.organization_id = v_org_filter)
      and (v_lang is null or p.working_language = v_lang)
  ),
  raw_department_counts as (
    select raw_department, count(*)::int as member_count from scoped group by raw_department
  ),
  member_groups as (
    select s.id, s.organization_id, s.org_type,
      case when d.member_count >= 5 then s.raw_department else 'Other departments' end as department
    from scoped s join raw_department_counts d using (raw_department)
  ),
  departments as (
    select department, count(*)::int as member_count
    from member_groups group by department having count(*) >= 5
  ),
  skill_people as (
    select mg.department, lower(trim(sk.skill)) as skill_key,
      min(trim(sk.skill)) as skill_label, sk.type, count(distinct mg.id)::int as member_count
    from public.skills sk join member_groups mg on mg.id = sk.user_id
    where coalesce(trim(sk.skill), '') <> '' and sk.type in ('can_teach', 'wants_to_learn')
    group by mg.department, lower(trim(sk.skill)), sk.type
    having count(distinct mg.id) >= 5
  ),
  skill_totals as (
    select lower(trim(sk.skill)) as skill_key, min(trim(sk.skill)) as skill_label,
      count(distinct mg.id)::int as member_count,
      count(distinct mg.id) filter (where sk.type = 'can_teach')::int as teachers,
      count(distinct mg.id) filter (where sk.type = 'wants_to_learn')::int as learners
    from public.skills sk join member_groups mg on mg.id = sk.user_id
    where coalesce(trim(sk.skill), '') <> '' and sk.type in ('can_teach', 'wants_to_learn')
    group by lower(trim(sk.skill))
    having count(distinct mg.id) >= 5
  ),
  skills as (
    select skill_key, skill_label,
      case when teachers >= 5 then teachers else null end as teachers,
      case when learners >= 5 then learners else null end as learners
    from skill_totals
  ),
  graph_nodes as (
    select jsonb_build_object('id', 'd:' || md5(department), 'kind', 'department',
      'label', department, 'count', member_count) as node from departments
    union all
    select jsonb_build_object('id', 's:' || skill_key, 'kind', 'skill', 'label', skill_label,
      'teachers', case when teachers >= 5 then teachers else null end,
      'learners', case when learners >= 5 then learners else null end) as node from skills
  ),
  graph_edges as (
    select jsonb_build_object('source', 'd:' || md5(sp.department), 'target', 's:' || sp.skill_key,
      'type', sp.type, 'count', sp.member_count) as edge
    from skill_people sp join skills s using (skill_key)
    join departments d using (department)
    union all
    select jsonb_build_object('source', 'd:' || md5(a.department), 'target', 'd:' || md5(b.department),
      'type', event_type, 'count', participant_count) as edge
    from (
      select event_type, least(department_a, department_b) as department_a,
        greatest(department_a, department_b) as department_b,
        count(distinct participant_id)::int as participant_count
      from (
        select 'session'::text as event_type, ma.department as department_a, mb.department as department_b,
          s.mentor_id as participant_id
        from public.sessions s join member_groups ma on ma.id = s.mentor_id
        join member_groups mb on mb.id = s.mentee_id
        where s.status = 'completed' and s.mentor_id <> s.mentee_id
        union all
        select 'session', ma.department, mb.department, s.mentee_id
        from public.sessions s join member_groups ma on ma.id = s.mentor_id
        join member_groups mb on mb.id = s.mentee_id
        where s.status = 'completed' and s.mentor_id <> s.mentee_id
        union all
        select 'connection', ma.department, mb.department, c.requester_id
        from public.connections c join member_groups ma on ma.id = c.requester_id
        join member_groups mb on mb.id = c.addressee_id
        where c.status = 'accepted' and c.requester_id <> c.addressee_id
        union all
        select 'connection', ma.department, mb.department, c.addressee_id
        from public.connections c join member_groups ma on ma.id = c.requester_id
        join member_groups mb on mb.id = c.addressee_id
        where c.status = 'accepted' and c.requester_id <> c.addressee_id
      ) participants
      group by event_type, least(department_a, department_b), greatest(department_a, department_b)
      having count(distinct participant_id) >= 5
    ) activity
    join departments a on a.department = activity.department_a
    join departments b on b.department = activity.department_b
  )
  select (select coalesce(jsonb_agg(node), '[]'::jsonb) from graph_nodes),
    (select coalesce(jsonb_agg(edge), '[]'::jsonb) from graph_edges)
  into v_nodes, v_edges;

  if v_scope = 'platform' then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type) order by o.name), '[]'::jsonb)
      into v_orgs from public.organizations o;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type)), '[]'::jsonb)
      into v_orgs from public.organizations o where o.id = v_caller_org;
  end if;

  select coalesce(jsonb_agg(language order by language), '[]'::jsonb) into v_langs
  from (
    select working_language as language from public.profiles
    where admin_scope = 'none' and deactivated_at is null
      and (v_scope = 'platform' or organization_id = v_caller_org)
    group by working_language having count(*) >= 5
  ) available_languages;

  return jsonb_build_object('nodes', v_nodes, 'edges', v_edges,
    'meta', jsonb_build_object('scope', v_scope, 'callerOrg', v_caller_org,
      'orgFilter', v_org_filter, 'language', v_lang, 'organizations', v_orgs, 'languages', v_langs));
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

  return (with scoped as (
    select p.id, p.onboarding_complete,
      coalesce(nullif(trim(p.department), ''), 'Other departments') as raw_department
    from public.profiles p
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_platform or p.organization_id = v_org)
  ), raw_counts as (
    select raw_department, count(*)::int member_count from scoped group by raw_department
  ), members as (
    select s.id, s.onboarding_complete,
      case when rc.member_count >= 5 then s.raw_department else 'Other departments' end as department
    from scoped s join raw_counts rc using (raw_department)
  ), departments as (
    select department, count(*)::int members,
      count(*) filter (where onboarding_complete)::int onboarded
    from members group by department having count(*) >= 5
  ), activity as (
    select m.department, m.id,
      exists (select 1 from public.sessions s where m.id in (s.mentor_id, s.mentee_id)
        and s.status in ('scheduled', 'completed')) as active,
      exists (select 1 from public.sessions s where s.mentor_id = m.id and s.status = 'completed') as gave_session
    from members m
  ), total_counts as (
    select count(*)::int total, count(*) filter (where onboarding_complete)::int onboarded from members
  )
  select jsonb_build_object(
    'totalUsers', case when total >= 5 then total else null end,
    'onboarded', case when onboarded >= 5 and total - onboarded >= 5 then onboarded else null end,
    'onboardingRate', case when onboarded >= 5 and total - onboarded >= 5
      then round(onboarded * 100.0 / total) else null end,
    'totalMatches', (select case when count(*) >= 5 then count(*)::int else null end
      from public.match_scores ms join public.profiles a on a.id = ms.user_a_id
      join public.profiles b on b.id = ms.user_b_id
      where v_platform or (a.organization_id = v_org and b.organization_id = v_org)),
    'sessionsByStatus', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'cnt', cnt))
      from (select s.status, case when count(*) >= 5 then count(*)::int else null end cnt from public.sessions s
        join public.profiles m on m.id = s.mentor_id
        where v_platform or m.organization_id = v_org group by s.status) statuses), '[]'::jsonb),
    'departmentParticipation', coalesce((select jsonb_agg(jsonb_build_object(
      'department', d.department, 'members', d.members,
      'active_members', case when a.active_count >= 5 and d.members - a.active_count >= 5 then a.active_count else null end,
      'mentors_active', case when a.mentor_count >= 5 and d.members - a.mentor_count >= 5 then a.mentor_count else null end)
      order by d.department)
      from departments d join lateral (select count(*) filter (where active)::int active_count,
        count(*) filter (where gave_session)::int mentor_count from activity x where x.department = d.department) a on true), '[]'::jsonb),
    'deptActivity', coalesce((select jsonb_agg(jsonb_build_object('department', d.department, 'session_count', a.session_count)
      order by d.department)
      from departments d join lateral (select case when count(distinct s.id) >= 5 then count(distinct s.id)::int else null end session_count
        from public.sessions s join members m on m.id in (s.mentor_id, s.mentee_id)
        where m.department = d.department and s.status = 'completed') a on true), '[]'::jsonb)
  ) from total_counts);
end;
$$;

notify pgrst, 'reload schema';
