create index if not exists session_messages_page_idx on public.session_messages(session_id, id desc);

create function public.my_session_messages_page(
  p_session_id bigint, p_before bigint default null, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid(); v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not exists (select 1 from public.sessions s where s.id = p_session_id and caller in (s.mentor_id, s.mentee_id)) then
    raise exception 'not_found';
  end if;
  return (with page as (
    select m.id, m.session_id, m.sender_id, m.kind, m.body, m.created_at
    from public.session_messages m
    where m.session_id = p_session_id and (p_before is null or m.id < p_before)
    order by m.id desc limit v_limit + 1
  ), visible as (
    select * from page order by id desc limit v_limit
  ) select jsonb_build_object(
    'messages', coalesce((select jsonb_agg(row_to_json(m) order by m.id) from visible m), '[]'::jsonb),
    'hasMore', (select count(*) > v_limit from page)
  ));
end;
$$;

revoke all on function public.my_session_messages_page(bigint, bigint, integer) from public, anon;
grant execute on function public.my_session_messages_page(bigint, bigint, integer) to authenticated;
notify pgrst, 'reload schema';
