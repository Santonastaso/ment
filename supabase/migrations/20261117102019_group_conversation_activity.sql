-- Return the last group-message timestamp so the inbox can order group and
-- one-to-one conversations together by real activity.
create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'route_token', g.route_token, 'name', g.name, 'description', g.description, 'created_at', g.created_at,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
    'joined', membership.user_id is not null,
    'is_owner', g.created_by = auth.uid(),
    'join_status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
    'join_expires_at', r.expires_at,
    'pending_count', case when g.created_by = auth.uid() then
      (select count(*) from public.group_join_requests q where q.group_id = g.id and q.status = 'pending' and q.expires_at > now()) else 0 end,
    'latest_message', latest.body,
    'latest_message_at', latest.created_at
  ) order by coalesce(latest.created_at, g.created_at) desc, g.id desc), '[]'::jsonb)
  from public.groups g join public.profiles p on p.organization_id = g.organization_id
    and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null
  left join public.group_members membership on membership.group_id = g.id and membership.user_id = auth.uid()
  left join public.group_join_requests r on r.group_id = g.id and r.user_id = auth.uid()
  left join lateral (
    select m.body, m.created_at from public.group_messages m
    where m.group_id = g.id and membership.user_id is not null
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
$$;

revoke all on function public.my_groups() from public, anon;
grant execute on function public.my_groups() to authenticated;
