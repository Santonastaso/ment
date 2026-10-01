-- Membership changes require the creator's approval; existing members are retained.
create table public.group_join_requests (
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (group_id, user_id)
);
alter table public.group_join_requests enable row level security;
revoke all on public.group_join_requests from public, anon, authenticated;
grant select on public.group_join_requests to authenticated;
grant all on public.group_join_requests to service_role;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.group_join_requests;
  end if;
end $$;
create policy group_join_requests_read on public.group_join_requests for select to authenticated using (
  exists (select 1 from public.groups g join public.profiles p on p.organization_id = g.organization_id
    where g.id = group_id and p.id = auth.uid() and p.deactivated_at is null
      and (user_id = auth.uid() or g.created_by = auth.uid()))
);

drop function public.join_group(bigint);
create function public.request_group_join(p_group_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.groups g join public.profiles p on p.organization_id = g.organization_id
    where g.id = p_group_id and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null)
    then raise exception 'not_allowed'; end if;
  perform 1 from public.groups where id = p_group_id for update;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid())
    then raise exception 'already_member'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'reason_required'; end if;
  if exists (select 1 from public.group_join_requests where group_id = p_group_id and user_id = auth.uid()
    and status = 'pending' and expires_at > now()) then raise exception 'request_pending'; end if;
  insert into public.group_join_requests(group_id, user_id, reason) values(p_group_id, auth.uid(), trim(p_reason))
  on conflict (group_id, user_id) do update set reason = excluded.reason, status = 'pending',
    created_at = now(), expires_at = now() + interval '7 days';
end;
$$;

create function public.review_group_join(p_group_id bigint, p_user_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.groups g join public.profiles p on p.organization_id = g.organization_id
    where g.id = p_group_id and g.created_by = auth.uid() and p.id = auth.uid() and p.deactivated_at is null)
    then raise exception 'not_allowed'; end if;
  perform 1 from public.group_join_requests where group_id = p_group_id and user_id = p_user_id
    and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'request_expired'; end if;
  if p_accept is null then raise exception 'decision_required'; end if;
  if p_accept then
    if not exists (select 1 from public.profiles p join public.groups g on g.organization_id = p.organization_id
      where p.id = p_user_id and g.id = p_group_id and p.admin_scope = 'none' and p.deactivated_at is null)
      then raise exception 'not_allowed'; end if;
    insert into public.group_members(group_id, user_id) values(p_group_id, p_user_id) on conflict do nothing;
  end if;
  update public.group_join_requests set status = case when p_accept then 'accepted' else 'declined' end
    where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create function public.withdraw_group_join(p_group_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.group_join_requests set status = 'withdrawn'
  where group_id = p_group_id and user_id = auth.uid() and status = 'pending'
$$;

create function public.pending_group_requests(p_group_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', p.name,
    'reason', r.reason, 'expires_at', r.expires_at) order by r.created_at), '[]'::jsonb)
  from public.group_join_requests r join public.groups g on g.id = r.group_id
  join public.profiles p on p.id = r.user_id and p.organization_id = g.organization_id and p.deactivated_at is null
  join public.profiles caller on caller.id = auth.uid() and caller.organization_id = g.organization_id and caller.deactivated_at is null
  where g.id = p_group_id and g.created_by = auth.uid() and r.status = 'pending' and r.expires_at > now()
$$;

create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description, 'created_at', g.created_at,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
    'joined', exists(select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()),
    'is_owner', g.created_by = auth.uid(),
    'join_status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
    'join_expires_at', r.expires_at,
    'pending_count', case when g.created_by = auth.uid() then
      (select count(*) from public.group_join_requests q where q.group_id = g.id and q.status = 'pending' and q.expires_at > now()) else 0 end
  ) order by lower(g.name), g.id), '[]'::jsonb)
  from public.groups g join public.profiles p on p.organization_id = g.organization_id
    and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null
  left join public.group_join_requests r on r.group_id = g.id and r.user_id = auth.uid()
$$;
revoke all on function public.request_group_join(bigint, text), public.review_group_join(bigint, uuid, boolean),
  public.withdraw_group_join(bigint), public.pending_group_requests(bigint), public.my_groups() from public, anon;
grant execute on function public.request_group_join(bigint, text), public.review_group_join(bigint, uuid, boolean),
  public.withdraw_group_join(bigint), public.pending_group_requests(bigint), public.my_groups() to authenticated;
notify pgrst, 'reload schema';
