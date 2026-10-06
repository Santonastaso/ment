-- Keep list previews in the same authorized RPCs that return the threads.
create or replace function public.my_sessions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(
      public.session_payload(s, caller) || jsonb_build_object(
        'request_expires_at', s.request_expires_at,
        'expired_at', s.expired_at,
        'latest_message', latest.body,
        'latest_message_kind', latest.kind
      ) order by s.last_activity_at desc, s.id desc
    )
    from public.sessions s
    left join lateral (
      select m.body, m.kind from public.session_messages m
      where m.session_id = s.id order by m.created_at desc, m.id desc limit 1
    ) latest on true
    where caller in (s.mentor_id, s.mentee_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description, 'created_at', g.created_at,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
    'joined', membership.user_id is not null,
    'is_owner', g.created_by = auth.uid(),
    'join_status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
    'join_expires_at', r.expires_at,
    'pending_count', case when g.created_by = auth.uid() then
      (select count(*) from public.group_join_requests q where q.group_id = g.id and q.status = 'pending' and q.expires_at > now()) else 0 end,
    'latest_message', latest.body
  ) order by lower(g.name), g.id), '[]'::jsonb)
  from public.groups g join public.profiles p on p.organization_id = g.organization_id
    and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null
  left join public.group_members membership on membership.group_id = g.id and membership.user_id = auth.uid()
  left join public.group_join_requests r on r.group_id = g.id and r.user_id = auth.uid()
  left join lateral (
    select m.body from public.group_messages m where m.group_id = g.id and membership.user_id is not null
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
$$;

revoke all on function public.my_sessions(), public.my_groups() from public, anon;
grant execute on function public.my_sessions(), public.my_groups() to authenticated;
