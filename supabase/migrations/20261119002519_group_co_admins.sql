-- Group creators can appoint co-admins. Co-admins can review join requests and
-- manage membership, while ownership and admin appointment remain creator-only.
alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members add constraint group_members_role_check
  check (role in ('owner', 'admin', 'member'));

drop policy if exists group_join_requests_read on public.group_join_requests;
create policy group_join_requests_read on public.group_join_requests for select to authenticated using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = auth.uid() and viewer.admin_scope = 'none' and viewer.deactivated_at is null
      and (
        group_join_requests.user_id = auth.uid()
        or exists (
          select 1 from public.group_members manager
          join public.groups g on g.id = manager.group_id
          where manager.group_id = group_join_requests.group_id
            and manager.user_id = auth.uid() and manager.role in ('owner', 'admin')
            and g.organization_id = viewer.organization_id
        )
      )
  )
);

create or replace function public.review_group_join(p_group_id bigint, p_user_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1
    from public.groups g
    join public.group_members manager on manager.group_id = g.id and manager.user_id = auth.uid()
      and manager.role in ('owner', 'admin')
    join public.profiles p on p.id = auth.uid() and p.organization_id = g.organization_id
      and p.admin_scope = 'none' and p.deactivated_at is null
    where g.id = p_group_id
    for update of manager;
  if not found then raise exception 'not_allowed'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot_review_self'; end if;
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

create or replace function public.pending_group_requests(p_group_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', p.name,
    'reason', r.reason, 'created_at', r.created_at, 'expires_at', r.expires_at) order by r.created_at), '[]'::jsonb)
  from public.group_join_requests r
  join public.profiles p on p.id = r.user_id
  where r.group_id = p_group_id and r.status = 'pending' and r.expires_at > now()
    and exists (select 1 from public.group_members manager
      join public.groups g on g.id = manager.group_id
      join public.profiles viewer on viewer.id = auth.uid()
        and viewer.organization_id = g.organization_id
        and viewer.admin_scope = 'none' and viewer.deactivated_at is null
      where manager.group_id = r.group_id and manager.user_id = auth.uid()
        and manager.role in ('owner', 'admin'))
$$;

create or replace function public.group_member_directory(p_group_id bigint, p_query text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_owner uuid; v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
  select g.organization_id, g.created_by into v_org, v_owner from public.groups g
  join public.group_members manager on manager.group_id = g.id and manager.user_id = auth.uid()
    and manager.role in ('owner', 'admin')
  join public.profiles viewer on viewer.id = auth.uid() and viewer.organization_id = g.organization_id
    and viewer.admin_scope = 'none' and viewer.deactivated_at is null
  where g.id = p_group_id;
  if v_org is null then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'can_manage_admins', v_owner = auth.uid(),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
      'is_owner', p.id = v_owner, 'is_admin', m.role = 'admin')
      order by (p.id = v_owner) desc, (m.role = 'admin') desc, lower(p.name)), '[]'::jsonb)
      from public.group_members m join public.profiles p on p.id = m.user_id where m.group_id = p_group_id),
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
      order by lower(c.name)), '[]'::jsonb) from (
        select p.id, p.name from public.profiles p
        where v_query is not null and length(v_query) between 2 and 80
          and p.organization_id = v_org and p.admin_scope = 'none'
          and p.deactivated_at is null and p.onboarding_complete
          and position(lower(v_query) in lower(p.name)) > 0
          and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p.id)
        order by lower(p.name) limit 10
      ) c)
  );
end;
$$;

create or replace function public.manage_group_member(p_group_id bigint, p_user_id uuid, p_add boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_owner uuid; v_target_role text;
begin
  select g.organization_id, g.created_by into v_org, v_owner from public.groups g
  join public.group_members manager on manager.group_id = g.id and manager.user_id = auth.uid()
    and manager.role in ('owner', 'admin')
  join public.profiles viewer on viewer.id = auth.uid() and viewer.organization_id = g.organization_id
    and viewer.admin_scope = 'none' and viewer.deactivated_at is null
  where g.id = p_group_id for update of g, manager;
  if v_org is null then raise exception 'not_allowed'; end if;
  if p_add is null or p_user_id is null then raise exception 'invalid_member'; end if;
  if p_add then
    if not exists (select 1 from public.profiles p where p.id = p_user_id
      and p.organization_id = v_org and p.admin_scope = 'none'
      and p.deactivated_at is null and p.onboarding_complete) then raise exception 'member_unavailable'; end if;
    insert into public.group_members(group_id, user_id) values (p_group_id, p_user_id) on conflict do nothing;
    update public.group_join_requests set status = 'accepted'
      where group_id = p_group_id and user_id = p_user_id and status = 'pending';
  else
    if p_user_id = v_owner then raise exception 'group_owner_cannot_leave'; end if;
    select role into v_target_role from public.group_members where group_id = p_group_id and user_id = p_user_id;
    if v_target_role = 'admin' and auth.uid() <> v_owner then raise exception 'owner_required'; end if;
    delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
    update public.group_join_requests set status = 'withdrawn'
      where group_id = p_group_id and user_id = p_user_id and status = 'accepted';
  end if;
end;
$$;

create or replace function public.manage_group_admin(p_group_id bigint, p_user_id uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user_id is null or p_admin is null then raise exception 'invalid_member'; end if;
  if not exists (select 1 from public.groups g join public.profiles owner on owner.id = auth.uid()
    where g.id = p_group_id and g.created_by = auth.uid() and owner.organization_id = g.organization_id
      and owner.admin_scope = 'none' and owner.deactivated_at is null) then raise exception 'owner_required'; end if;
  if p_user_id = auth.uid() then raise exception 'group_owner_cannot_change'; end if;
  update public.group_members set role = case when p_admin then 'admin' else 'member' end
    where group_id = p_group_id and user_id = p_user_id;
  if not found then raise exception 'member_unavailable'; end if;
end;
$$;

create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'route_token', g.route_token, 'name', g.name, 'description', g.description, 'created_at', g.created_at,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
    'joined', membership.user_id is not null,
    'is_owner', g.created_by = auth.uid(),
    'is_manager', membership.role in ('owner', 'admin'),
    'join_status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
    'join_expires_at', r.expires_at,
    'pending_count', case when membership.role in ('owner', 'admin') then
      (select count(*) from public.group_join_requests q where q.group_id = g.id and q.status = 'pending' and q.expires_at > now()) else 0 end,
    'latest_message', latest.body, 'latest_message_at', latest.created_at
  ) order by coalesce(latest.created_at, g.created_at) desc, g.id desc), '[]'::jsonb)
  from public.groups g join public.profiles p on p.organization_id = g.organization_id
    and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null
  left join public.group_members membership on membership.group_id = g.id and membership.user_id = auth.uid()
  left join public.group_join_requests r on r.group_id = g.id and r.user_id = auth.uid()
  left join lateral (select m.body, m.created_at from public.group_messages m
    where m.group_id = g.id and membership.user_id is not null order by m.created_at desc, m.id desc limit 1) latest on true
$$;

revoke all on function public.review_group_join(bigint, uuid, boolean), public.pending_group_requests(bigint),
  public.group_member_directory(bigint, text), public.manage_group_member(bigint, uuid, boolean),
  public.manage_group_admin(bigint, uuid, boolean), public.my_groups() from public, anon;
grant execute on function public.review_group_join(bigint, uuid, boolean), public.pending_group_requests(bigint),
  public.group_member_directory(bigint, text), public.manage_group_member(bigint, uuid, boolean),
  public.manage_group_admin(bigint, uuid, boolean), public.my_groups() to authenticated;
notify pgrst, 'reload schema';
