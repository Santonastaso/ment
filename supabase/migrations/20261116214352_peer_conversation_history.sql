-- One inbox thread per pair of members. Historical mentoring requests remain
-- distinct records, while their messages are presented as one conversation.
-- Archiving is per member and reversible; new activity resurfaces the thread.
create table public.peer_conversation_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  peer_id uuid not null references public.profiles(id) on delete cascade,
  archived_at timestamptz,
  primary key (user_id, peer_id),
  check (user_id <> peer_id)
);
create index peer_conversation_preferences_peer_idx on public.peer_conversation_preferences(peer_id);

alter table public.peer_conversation_preferences enable row level security;
revoke all on public.peer_conversation_preferences from public, anon, authenticated;
grant all on public.peer_conversation_preferences to service_role;

create or replace function public.set_peer_conversation_archived(
  p_session_id bigint,
  p_archived boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  peer uuid;
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;

  select case when s.mentor_id = caller then s.mentee_id else s.mentor_id end
    into peer
  from public.sessions s
  where s.id = p_session_id and caller in (s.mentor_id, s.mentee_id);

  if peer is null then raise exception 'not_found'; end if;

  if coalesce(p_archived, false) then
    insert into public.peer_conversation_preferences(user_id, peer_id, archived_at)
    values (caller, peer, now())
    on conflict (user_id, peer_id) do update set archived_at = excluded.archived_at;
  else
    delete from public.peer_conversation_preferences
    where user_id = caller and peer_id = peer;
  end if;
end;
$$;

create or replace function public.my_sessions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;
  return coalesce((
    select jsonb_agg(
      public.session_payload(s, caller) || jsonb_build_object(
        'request_expires_at', s.request_expires_at,
        'expired_at', s.expired_at,
        'latest_message', latest.body,
        'latest_message_kind', latest.kind,
        'conversation_archived', prefs.archived_at is not null and not exists (
          select 1 from public.sessions newer
          where caller in (newer.mentor_id, newer.mentee_id)
            and case when newer.mentor_id = caller then newer.mentee_id else newer.mentor_id end =
                case when s.mentor_id = caller then s.mentee_id else s.mentor_id end
            and newer.last_activity_at > prefs.archived_at
        )
      ) order by s.last_activity_at desc, s.id desc
    )
    from public.sessions s
    left join public.peer_conversation_preferences prefs
      on prefs.user_id = caller
     and prefs.peer_id = case when s.mentor_id = caller then s.mentee_id else s.mentor_id end
    left join lateral (
      select m.body, m.kind from public.session_messages m
      where m.session_id = s.id order by m.created_at desc, m.id desc limit 1
    ) latest on true
    where caller in (s.mentor_id, s.mentee_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.my_session_messages(
  p_session_id bigint, p_before bigint default null, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  peer uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;

  select case when s.mentor_id = caller then s.mentee_id else s.mentor_id end
    into peer
  from public.sessions s
  where s.id = p_session_id and caller in (s.mentor_id, s.mentee_id);

  if peer is null then raise exception 'not_found'; end if;

  return (with page as (
    select m.id, m.session_id, m.sender_id, m.kind, m.body, m.created_at, m.client_id
    from public.session_messages m
    join public.sessions s on s.id = m.session_id
    where caller in (s.mentor_id, s.mentee_id)
      and case when s.mentor_id = caller then s.mentee_id else s.mentor_id end = peer
      and (p_before is null or m.id < p_before)
    order by m.id desc limit v_limit + 1
  ), visible as (
    select * from page order by id desc limit v_limit
  ) select jsonb_build_object(
    'messages', coalesce((select jsonb_agg(row_to_json(m) order by m.id) from visible m), '[]'::jsonb),
    'hasMore', (select count(*) > v_limit from page)
  ));
end;
$$;

create or replace function public.mark_session_read(p_session_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  peer uuid;
begin
  if not public.is_active_user() then raise exception 'account_deactivated'; end if;

  select case when s.mentor_id = caller then s.mentee_id else s.mentor_id end
    into peer
  from public.sessions s
  where s.id = p_session_id and caller in (s.mentor_id, s.mentee_id);

  if peer is null then raise exception 'not_found'; end if;

  insert into public.session_reads(session_id, user_id, last_read_at)
  select s.id, caller, now()
  from public.sessions s
  where caller in (s.mentor_id, s.mentee_id)
    and case when s.mentor_id = caller then s.mentee_id else s.mentor_id end = peer
  on conflict (session_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.set_peer_conversation_archived(bigint, boolean) from public, anon;
revoke all on function public.my_sessions() from public, anon;
revoke all on function public.my_session_messages(bigint, bigint, integer) from public, anon;
revoke all on function public.mark_session_read(bigint) from public, anon;
grant execute on function public.set_peer_conversation_archived(bigint, boolean) to authenticated;
grant execute on function public.my_sessions() to authenticated;
grant execute on function public.my_session_messages(bigint, bigint, integer) to authenticated;
grant execute on function public.mark_session_read(bigint) to authenticated;

notify pgrst, 'reload schema';
