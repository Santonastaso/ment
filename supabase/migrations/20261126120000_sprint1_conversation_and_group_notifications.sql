-- Sprint 1: let a member remove a conversation from their own inbox without
-- deleting shared messages or the other participant's history.
alter table public.peer_conversation_preferences
  add column if not exists deleted_at timestamptz;

create or replace function public.delete_peer_conversation(p_session_id bigint)
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

  insert into public.peer_conversation_preferences(user_id, peer_id, deleted_at)
  values (caller, peer, now())
  on conflict (user_id, peer_id) do update set deleted_at = excluded.deleted_at;
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
      and (prefs.deleted_at is null or s.last_activity_at > prefs.deleted_at)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.delete_peer_conversation(bigint) from public, anon;
grant execute on function public.delete_peer_conversation(bigint) to authenticated;

-- Queue one generic email for each active group owner/co-admin. The email does
-- not include the applicant's reason; the recipient reads that in the app.
create or replace function public.enqueue_group_join_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  group_name text;
begin
  if new.status <> 'pending' then return new; end if;

  select g.name into group_name from public.groups g where g.id = new.group_id;

  insert into public.notification_outbox (user_id, channel, topic, payload, idempotency_key)
  select manager.user_id, 'email', 'group_join_request_received',
    jsonb_build_object('group_id', new.group_id, 'requester_id', new.user_id, 'group_name', group_name),
    'group-join:' || new.group_id || ':' || new.user_id || ':' || manager.user_id || ':' || extract(epoch from new.created_at)::bigint
  from public.group_members manager
  where manager.group_id = new.group_id and manager.role in ('owner', 'admin')
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_group_join_notification() from public, anon, authenticated;
drop trigger if exists enqueue_group_join_notification on public.group_join_requests;
create trigger enqueue_group_join_notification
after insert or update of status on public.group_join_requests
for each row execute function public.enqueue_group_join_notification();
