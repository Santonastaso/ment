create function public.group_member_directory(p_group_id bigint, p_query text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
  select g.organization_id into v_org from public.groups g
  join public.profiles owner on owner.id = auth.uid() and owner.organization_id = g.organization_id
    and owner.admin_scope = 'none' and owner.deactivated_at is null
  where g.id = p_group_id and g.created_by = auth.uid();
  if v_org is null then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
      'is_owner', p.id = auth.uid()) order by (p.id = auth.uid()) desc, lower(p.name)), '[]'::jsonb)
      from public.group_members m join public.profiles p on p.id = m.user_id
      where m.group_id = p_group_id),
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
      order by lower(c.name)), '[]'::jsonb) from (
        select p.id, p.name from public.profiles p
        where v_query is not null and length(v_query) >= 2 and length(v_query) <= 80
          and p.organization_id = v_org and p.admin_scope = 'none'
          and p.deactivated_at is null and p.onboarding_complete
          and position(lower(v_query) in lower(p.name)) > 0
          and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p.id)
        order by lower(p.name) limit 10
      ) c)
  );
end;
$$;

create function public.manage_group_member(p_group_id bigint, p_user_id uuid, p_add boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select g.organization_id into v_org from public.groups g
  join public.profiles owner on owner.id = auth.uid() and owner.organization_id = g.organization_id
    and owner.admin_scope = 'none' and owner.deactivated_at is null
  where g.id = p_group_id and g.created_by = auth.uid() for update of g;
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
    if p_user_id = auth.uid() then raise exception 'group_owner_cannot_leave'; end if;
    delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
    update public.group_join_requests set status = 'withdrawn'
      where group_id = p_group_id and user_id = p_user_id and status = 'accepted';
  end if;
end;
$$;

revoke all on function public.group_member_directory(bigint, text), public.manage_group_member(bigint, uuid, boolean) from public, anon;
grant execute on function public.group_member_directory(bigint, text), public.manage_group_member(bigint, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
