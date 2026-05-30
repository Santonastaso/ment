-- 0017_most_active_users.sql
-- Admin Overview leaderboard: most active people overall by total session
-- activity (mentor OR mentee), counting scheduled + completed sessions.
-- Org-scoped identically to admin_stats.topMentors (same org only unless the
-- caller is a platform admin) and limited to non-admin profiles.

create or replace function public.most_active_users(p_limit int default 10)
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

  return coalesce(
    (select jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'department', department,
        'sessions', sessions))
     from (
       select p.id, p.name, p.department,
              count(distinct s.id)::int as sessions
       from public.profiles p
       join public.sessions s
         on (s.mentor_id = p.id or s.mentee_id = p.id)
        and s.status in ('scheduled', 'completed')
       where p.admin_scope = 'none'
         and p.deactivated_at is null
         and (v_platform or p.organization_id = v_org)
       group by p.id, p.name, p.department
       having count(distinct s.id) > 0
       order by sessions desc, p.name asc
       limit greatest(1, least(coalesce(p_limit, 10), 50))
     ) ranked),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.most_active_users(int) to authenticated;
