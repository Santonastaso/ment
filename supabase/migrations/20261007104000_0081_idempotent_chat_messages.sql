alter table public.session_messages add column client_id uuid;
alter table public.group_messages add column client_id uuid;

create unique index session_messages_client_id on public.session_messages(session_id, sender_id, client_id) where client_id is not null;
create unique index group_messages_client_id on public.group_messages(group_id, sender_id, client_id) where client_id is not null;

drop function public.send_session_message(bigint, text);
create function public.send_session_message(p_session_id bigint, p_body text, p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); result public.session_messages; normalized text := trim(coalesce(p_body, ''));
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;
  if p_client_id is null or char_length(normalized) not between 1 and 6000 then raise exception 'invalid_message'; end if;
  if not exists (select 1 from public.sessions s where s.id = p_session_id and caller in (s.mentor_id, s.mentee_id)) then
    raise exception 'not_found';
  end if;
  insert into public.session_messages(session_id, sender_id, kind, body, client_id)
  values (p_session_id, caller, 'message', normalized, p_client_id)
  on conflict (session_id, sender_id, client_id) where client_id is not null do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.session_messages
    where session_id = p_session_id and sender_id = caller and client_id = p_client_id;
  end if;
  if result.id is null or result.body <> normalized then raise exception 'message_id_conflict'; end if;
  return to_jsonb(result);
end;
$$;
revoke all on function public.send_session_message(bigint, text, uuid) from public, anon;
grant execute on function public.send_session_message(bigint, text, uuid) to authenticated;

drop function public.send_group_message(bigint, text);
create function public.send_group_message(p_group_id bigint, p_body text, p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); result public.group_messages; normalized text := trim(coalesce(p_body, ''));
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;
  if p_client_id is null or char_length(normalized) not between 1 and 6000 then raise exception 'invalid_message'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = caller) then
    raise exception 'not_a_member';
  end if;
  insert into public.group_messages(group_id, sender_id, body, client_id)
  values (p_group_id, caller, normalized, p_client_id)
  on conflict (group_id, sender_id, client_id) where client_id is not null do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.group_messages
    where group_id = p_group_id and sender_id = caller and client_id = p_client_id;
  end if;
  if result.id is null or result.body <> normalized then raise exception 'message_id_conflict'; end if;
  return to_jsonb(result) || jsonb_build_object('sender_name', (select name from public.profiles where id = caller));
end;
$$;
revoke all on function public.send_group_message(bigint, text, uuid) from public, anon;
grant execute on function public.send_group_message(bigint, text, uuid) to authenticated;

create or replace function public.my_session_messages(
  p_session_id bigint, p_before bigint default null, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid(); v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;
  if not exists (select 1 from public.sessions s where s.id = p_session_id and caller in (s.mentor_id, s.mentee_id)) then
    raise exception 'not_found';
  end if;
  return (with page as (
    select m.id, m.session_id, m.sender_id, m.kind, m.body, m.created_at, m.client_id
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

create or replace function public.my_group_messages(
  p_group_id bigint, p_limit integer default 50, p_before bigint default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  return (with page as (
    select gm.id, gm.group_id, gm.sender_id, p.name as sender_name, gm.body, gm.created_at, gm.client_id
    from public.group_messages gm join public.profiles p on p.id = gm.sender_id
    where gm.group_id = p_group_id and (p_before is null or gm.id < p_before)
    order by gm.id desc limit v_limit + 1
  ), visible as (
    select * from page order by id desc limit v_limit
  ) select jsonb_build_object(
    'messages', coalesce((select jsonb_agg(row_to_json(q) order by q.id) from visible q), '[]'::jsonb),
    'hasMore', (select count(*) > v_limit from page)
  ));
end;
$$;
notify pgrst, 'reload schema';
