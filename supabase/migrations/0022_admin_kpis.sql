-- 0022 Admin KPI dashboard (P2)
--
-- Real, org-scoped mentoring KPIs computed from live tables. Split into an
-- internal computation function (no auth, not client-callable, so it can be
-- unit-tested in isolation) and a thin auth wrapper.

create or replace function public._admin_kpis(p_org uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_total_users int;
  v_onboarded int;
  v_potential_mentors int;
  v_active_mentors int;
  v_paused_mentors int;
  v_participants int;
  v_avg_rating numeric;
  v_pairs_total int;
  v_pairs_repeat int;
  v_avg_response numeric;
  v_cross_dept int;
  v_same_dept int;
  v_isolated int;
  v_most_requested jsonb;
  v_most_shared jsonb;
  v_gaps jsonb;
  v_growth jsonb;
begin
  select count(*) into v_total_users
  from public.profiles where organization_id = p_org and admin_scope = 'none' and deactivated_at is null;

  select count(*) into v_onboarded
  from public.profiles where organization_id = p_org and admin_scope = 'none' and deactivated_at is null and onboarding_complete;

  select count(distinct p.id) into v_potential_mentors
  from public.profiles p
  join public.skills s on s.user_id = p.id and s.type = 'can_teach'
  where p.organization_id = p_org and p.admin_scope = 'none' and p.deactivated_at is null;

  select count(distinct s.mentor_id) into v_active_mentors
  from public.sessions s
  join public.profiles p on p.id = s.mentor_id
  where p.organization_id = p_org and s.status = 'completed';

  select count(*) into v_paused_mentors
  from public.profiles p
  where p.organization_id = p_org and p.admin_scope = 'none' and p.deactivated_at is null
    and exists (select 1 from public.skills sk where sk.user_id = p.id and sk.type = 'can_teach')
    and not public.is_currently_available_mentor(p.id);

  -- Participation: share of non-admin users who took part in >=1 session.
  select count(distinct uid) into v_participants
  from (
    select s.mentor_id as uid from public.sessions s join public.profiles p on p.id = s.mentor_id where p.organization_id = p_org
    union
    select s.mentee_id from public.sessions s join public.profiles p on p.id = s.mentee_id where p.organization_id = p_org
  ) z;

  select round(avg(r), 2) into v_avg_rating
  from (
    select s.mentee_rating as r from public.sessions s join public.profiles p on p.id = s.mentor_id
      where p.organization_id = p_org and s.status = 'completed' and s.mentee_rating is not null
    union all
    select s.mentor_rating from public.sessions s join public.profiles p on p.id = s.mentor_id
      where p.organization_id = p_org and s.status = 'completed' and s.mentor_rating is not null
  ) z;

  -- Repeat mentorship rate: share of distinct mentor->mentee pairs that have
  -- completed more than one session together.
  with pairs as (
    select s.mentor_id, s.mentee_id, count(*) as n
    from public.sessions s
    join public.profiles p on p.id = s.mentor_id
    where p.organization_id = p_org and s.status = 'completed'
    group by s.mentor_id, s.mentee_id
  )
  select count(*), count(*) filter (where n > 1) into v_pairs_total, v_pairs_repeat from pairs;

  -- Avg time-to-schedule (hours) as a proxy for response time to requests.
  select round(avg(extract(epoch from (s.scheduled_at - s.created_at)) / 3600.0)::numeric, 1)
  into v_avg_response
  from public.sessions s
  join public.profiles p on p.id = s.mentor_id
  where p.organization_id = p_org
    and s.scheduled_at is not null
    and s.scheduled_at > s.created_at
    and s.status in ('scheduled', 'completed');

  select
    count(*) filter (where mp.department is distinct from ep.department),
    count(*) filter (where mp.department is not distinct from ep.department)
  into v_cross_dept, v_same_dept
  from public.sessions s
  join public.profiles mp on mp.id = s.mentor_id
  join public.profiles ep on ep.id = s.mentee_id
  where mp.organization_id = p_org and s.status = 'completed';

  -- Isolated: onboarded users with zero sessions either side.
  select count(*) into v_isolated
  from public.profiles p
  where p.organization_id = p_org and p.admin_scope = 'none' and p.deactivated_at is null and p.onboarding_complete
    and not exists (
      select 1 from public.sessions s where s.mentor_id = p.id or s.mentee_id = p.id
    );

  select coalesce(jsonb_agg(x order by (x->>'count')::int desc, lower(x->>'skill')), '[]'::jsonb)
  into v_most_requested
  from (
    select jsonb_build_object('skill', s.skill, 'count', count(distinct s.user_id)) as x
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'wants_to_learn'
    group by s.skill order by count(distinct s.user_id) desc, lower(s.skill) limit 10
  ) q;

  select coalesce(jsonb_agg(x order by (x->>'count')::int desc, lower(x->>'skill')), '[]'::jsonb)
  into v_most_shared
  from (
    select jsonb_build_object('skill', s.skill, 'count', count(distinct s.user_id)) as x
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'can_teach'
    group by s.skill order by count(distinct s.user_id) desc, lower(s.skill) limit 10
  ) q;

  -- Demand vs supply gap: high wants_to_learn, low can_teach.
  with demand as (
    select lower(trim(s.skill)) as skill, count(distinct s.user_id) as d
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'wants_to_learn' group by 1
  ),
  supply as (
    select lower(trim(s.skill)) as skill, count(distinct s.user_id) as su
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'can_teach' group by 1
  )
  select coalesce(jsonb_agg(q.x order by q.gap desc, q.skill), '[]'::jsonb)
  into v_gaps
  from (
    select d.skill as skill, (d.d - coalesce(su.su, 0)) as gap,
           jsonb_build_object('skill', d.skill, 'demand', d.d, 'supply', coalesce(su.su, 0)) as x
    from demand d left join supply su on su.skill = d.skill
    where d.d - coalesce(su.su, 0) > 0
    order by gap desc, d.skill
    limit 10
  ) q;

  with months as (
    select generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as m
  ),
  per as (
    select date_trunc('month', s.created_at) as m, count(*) as cnt
    from public.sessions s join public.profiles p on p.id = s.mentor_id
    where p.organization_id = p_org group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(months.m, 'YYYY-MM'), 'sessions', coalesce(per.cnt, 0)) order by months.m), '[]'::jsonb)
  into v_growth
  from months left join per on per.m = months.m;

  return jsonb_build_object(
    'totalUsers', v_total_users,
    'onboarded', v_onboarded,
    'potentialMentors', v_potential_mentors,
    'activeMentors', v_active_mentors,
    'inactiveMentors', greatest(0, v_potential_mentors - v_active_mentors),
    'pausedMentors', v_paused_mentors,
    'participationRate', case when v_onboarded = 0 then 0 else round(v_participants * 100.0 / v_onboarded) end,
    'avgRating', coalesce(v_avg_rating, 0),
    'repeatRate', case when v_pairs_total = 0 then 0 else round(v_pairs_repeat * 100.0 / v_pairs_total) end,
    'avgResponseHours', coalesce(v_avg_response, 0),
    'crossDeptSessions', coalesce(v_cross_dept, 0),
    'sameDeptSessions', coalesce(v_same_dept, 0),
    'isolatedEmployees', v_isolated,
    'mostRequested', v_most_requested,
    'mostShared', v_most_shared,
    'demandSupplyGaps', v_gaps,
    'growth', v_growth
  );
end;
$function$;

revoke all on function public._admin_kpis(uuid) from public, anon, authenticated;

-- Public wrapper: org admins see their org; platform admins may target any org.
create or replace function public.admin_kpis(p_org uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if p_org is not null and public.is_platform_admin(v_caller) then
    v_org := p_org;
  else
    select organization_id into v_org from public.profiles where id = v_caller;
  end if;
  if v_org is null then raise exception 'no_org'; end if;
  return public._admin_kpis(v_org);
end;
$function$;

grant execute on function public.admin_kpis(uuid) to authenticated;
