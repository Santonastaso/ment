-- 0021 Client role model (F3) + owner churn rate
--
-- Adds an explicit role to profiles: admin / team_lead / manager / employee.
--   * admin      — org/platform admins (manage org settings); mirrors admin_scope
--   * team_lead  — Team Insights shows their reports AND everyone below them
--   * manager    — Team Insights shows only direct reports (gated by min size)
--   * employee   — no team insights
-- Team Lead vs Manager is set by an admin (no data to infer it); everyone with
-- reports backfills to 'manager', admins to 'admin', the rest to 'employee'.

alter table public.profiles
  add column if not exists role text not null default 'employee'
    check (role in ('admin', 'team_lead', 'manager', 'employee'));

-- Backfill from existing admin_scope + reporting lines.
update public.profiles p set role = 'admin'
  where p.admin_scope in ('org', 'platform') and p.role <> 'admin';

update public.profiles p set role = 'manager'
  where p.admin_scope = 'none'
    and p.role = 'employee'
    and exists (select 1 from public.profiles c where c.manager_id = p.id);

-- Protect role from self-service writes (only service_role / admin RPCs).
create or replace function public.guard_profile_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.is_admin is distinct from old.is_admin
     or new.admin_scope is distinct from old.admin_scope
     or new.organization_id is distinct from old.organization_id
     or new.manager_id is distinct from old.manager_id
     or new.role is distinct from old.role
     or new.deactivated_at is distinct from old.deactivated_at then
    raise exception 'protected_columns: only service_role or admin RPCs can change admin/org columns, role, manager_id, or deactivated_at';
  end if;
  return new;
end;
$$;

-- Report set a given manager/lead can see, by role:
--   team_lead -> transitive reports (whole sub-tree)
--   manager   -> direct reports only
--   else      -> none
create or replace function public.team_report_ids(p_manager_id uuid)
returns setof uuid
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = p_manager_id;
  if v_role = 'team_lead' then
    return query
      with recursive sub as (
        select id from public.profiles
          where manager_id = p_manager_id and deactivated_at is null
        union
        select c.id from public.profiles c
          join sub on c.manager_id = sub.id
          where c.deactivated_at is null
      )
      select id from sub;
  elsif v_role = 'manager' then
    return query
      select id from public.profiles
        where manager_id = p_manager_id and deactivated_at is null;
  else
    return;
  end if;
end;
$$;

revoke all on function public.team_report_ids(uuid) from public, anon, authenticated;

-- Team dashboard now respects role: employees get no insights; managers/leads
-- see their (direct / transitive) report set, still suppressed below the org's
-- minimum size for anonymity.
create or replace function public.team_skill_gaps(p_manager_id uuid default auth.uid())
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_org_type text;
  v_min int := 3;
  v_role text;
  v_count int;
  v_total int;
  v_gaps jsonb;
  v_strengths jsonb;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_manager_id is null then p_manager_id := v_caller; end if;
  if p_manager_id <> v_caller and not public.is_admin(v_caller) then
    raise exception 'forbidden';
  end if;

  select organization_id, role into v_org, v_role from public.profiles where id = p_manager_id;
  select coalesce(o.type, 'intra'), coalesce(o.min_team_dashboard_size, 3)
    into v_org_type, v_min
  from public.organizations o where o.id = v_org;
  if v_org_type = 'inter' and v_min < 3 then v_min := 3; end if;

  -- Employees (and anyone without a manager/lead role) have no team insights.
  if v_role not in ('team_lead', 'manager') then
    return jsonb_build_object(
      'reportCount', 0, 'gated', true, 'role', v_role,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', 'Team insights are available to managers and team leads.'
    );
  end if;

  select count(*) into v_count from public.team_report_ids(p_manager_id);

  if v_count = 0 then
    return jsonb_build_object(
      'reportCount', 0, 'gated', false, 'role', v_role,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', 'No reports linked. Set up reporting lines in Admin → Users to populate this dashboard.'
    );
  end if;

  if v_count < v_min then
    return jsonb_build_object(
      'reportCount', v_count, 'gated', true, 'role', v_role,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', format(
        'Suppressed: %s report%s. We hide the team report until you have at least %s reports so individual answers stay anonymous.',
        v_count, case when v_count = 1 then '' else 's' end, v_min
      )
    );
  end if;

  v_total := v_count;

  with reports as (
    select id from public.team_report_ids(p_manager_id)
  ),
  buckets as (
    select s.skill, s.type, count(distinct s.user_id) as cnt
    from public.skills s
    join reports r on r.id = s.user_id
    group by s.skill, s.type
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object('skill', skill, 'count', cnt,
                         'share', round(cnt::numeric * 100 / v_total))
      order by cnt desc, lower(skill)
    ) filter (where type = 'wants_to_learn'), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('skill', skill, 'count', cnt,
                         'share', round(cnt::numeric * 100 / v_total))
      order by cnt desc, lower(skill)
    ) filter (where type = 'can_teach'), '[]'::jsonb)
  into v_gaps, v_strengths
  from buckets;

  return jsonb_build_object(
    'reportCount', v_count, 'gated', false, 'role', v_role,
    'gaps', coalesce(v_gaps, '[]'::jsonb),
    'strengths', coalesce(v_strengths, '[]'::jsonb),
    'orgType', v_org_type,
    'minTeamDashboardSize', v_min
  );
end;
$function$;

-- Admin RPC to set a non-admin user's role (team_lead / manager / employee).
-- Admins are managed via admin_scope, so 'admin' is not settable here and
-- admin-scoped users can't be re-roled.
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if p_user_id = v_caller then raise exception 'cannot_set_self'; end if;
  if not public.can_manage_profile(p_user_id) then raise exception 'forbidden'; end if;
  if p_role not in ('team_lead', 'manager', 'employee') then raise exception 'invalid_role'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and admin_scope <> 'none') then
    raise exception 'cannot_role_admin';
  end if;
  update public.profiles set role = p_role where id = p_user_id and public.can_manage_profile(id);
end;
$function$;

grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- Expose role in the admin user listing.
create or replace function public.admin_users(p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
  v_users jsonb;
  v_total int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  select count(*) into v_total
  from public.profiles
  where admin_scope = 'none'
    and (v_platform or organization_id = v_org);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'email', email,
    'name', name,
    'department', department,
    'job_title', job_title,
    'role', role,
    'onboarding_complete', onboarding_complete,
    'deactivated_at', deactivated_at,
    'must_change_password', must_change_password,
    'manager_email', manager_email
  ) order by name), '[]'::jsonb)
  into v_users
  from (
    select
      u.id, au.email, u.name, u.department, u.job_title, u.role,
      u.onboarding_complete, u.deactivated_at, u.must_change_password,
      m_au.email as manager_email
    from public.profiles u
    join auth.users au on au.id = u.id
    left join public.profiles m on m.id = u.manager_id
    left join auth.users m_au on m_au.id = m.id
    where u.admin_scope = 'none'
      and (v_platform or u.organization_id = v_org)
    order by u.name
    limit p_limit offset p_offset
  ) q;

  return jsonb_build_object('users', v_users, 'total', v_total);
end;
$function$;

-- Owner stats: add a real churn rate % per org (churned / ever-onboarded).
create or replace function public.platform_owner_stats()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_platform_admin(v_caller) then raise exception 'platform_admin_only'; end if;

  return jsonb_build_object(
    'organizations', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'organizationId', o.id,
        'organizationName', o.name,
        'slug', o.slug,
        'totalUsers', (select count(*) from public.profiles p where p.organization_id = o.id and p.admin_scope = 'none' and p.deactivated_at is null),
        'onboarded', (select count(*) from public.profiles p where p.organization_id = o.id and p.admin_scope = 'none' and p.onboarding_complete and p.deactivated_at is null),
        'onboardingRate', (
          select case when count(*) = 0 then 0 else round(count(*) filter (where p.onboarding_complete) * 100.0 / count(*)) end
          from public.profiles p
          where p.organization_id = o.id and p.admin_scope = 'none' and p.deactivated_at is null
        ),
        'activeMembers', (
          select count(*)
          from public.profiles p
          join auth.users au on au.id = p.id
          where p.organization_id = o.id
            and p.admin_scope = 'none'
            and p.deactivated_at is null
            and au.last_sign_in_at >= now() - interval '30 days'
        ),
        'sessions', (
          select count(*)
          from public.sessions s
          join public.profiles p on p.id = s.mentor_id
          where p.organization_id = o.id
        ),
        'churned', (
          select count(*)
          from public.profiles p
          where p.organization_id = o.id and p.admin_scope = 'none' and p.deactivated_at is not null
        ),
        'churnRate', (
          select case when count(*) = 0 then 0
                 else round(count(*) filter (where p.deactivated_at is not null) * 100.0 / count(*)) end
          from public.profiles p
          where p.organization_id = o.id and p.admin_scope = 'none'
        )
      ) order by o.name)
      from public.organizations o),
      '[]'::jsonb
    )
  );
end;
$function$;
