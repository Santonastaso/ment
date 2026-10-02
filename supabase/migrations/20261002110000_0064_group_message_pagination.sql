drop function public.my_group_messages(bigint, integer);

create function public.my_group_messages(
  p_group_id bigint, p_limit integer default 50, p_before bigint default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;

  return (with page as (
    select gm.id, gm.group_id, gm.sender_id, p.name as sender_name, gm.body, gm.created_at
    from public.group_messages gm join public.profiles p on p.id = gm.sender_id
    where gm.group_id = p_group_id and (p_before is null or gm.id < p_before)
    order by gm.id desc limit v_limit + 1
  ), visible as (
    select * from page order by id desc limit v_limit
  )
  select jsonb_build_object(
    'messages', coalesce((select jsonb_agg(row_to_json(q) order by q.id) from visible q), '[]'::jsonb),
    'hasMore', (select count(*) > v_limit from page)
  ));
end;
$$;

revoke all on function public.my_group_messages(bigint, integer, bigint) from public, anon;
grant execute on function public.my_group_messages(bigint, integer, bigint) to authenticated;
notify pgrst, 'reload schema';
