-- Queue member notifications at the session boundary, regardless of which RPC
-- created or updated the session. The unique key makes retries harmless.
alter table public.notification_outbox
  add column if not exists attempts integer not null default 0
  check (attempts >= 0);

create or replace function public.enqueue_session_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notification_outbox (user_id, channel, topic, payload, idempotency_key)
    values (new.mentor_id, 'email', 'session_request_received',
      jsonb_build_object('session_id', new.id), 'session:' || new.id || ':requested')
    on conflict (idempotency_key) do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'scheduled' then
    insert into public.notification_outbox (user_id, channel, topic, payload, idempotency_key)
    values (new.mentee_id, 'email', 'session_request_accepted',
      jsonb_build_object('session_id', new.id), 'session:' || new.id || ':accepted')
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_session_notification() from public, anon, authenticated;
drop trigger if exists enqueue_session_notification on public.sessions;
create trigger enqueue_session_notification
after insert or update of status on public.sessions
for each row execute function public.enqueue_session_notification();

create or replace function public.enqueue_meeting_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare queued integer;
begin
  insert into public.notification_outbox (user_id, channel, topic, payload, idempotency_key)
  select recipient.user_id, 'email', 'meeting_reminder',
    jsonb_build_object('session_id', s.id, 'scheduled_at', s.scheduled_at),
    'session:' || s.id || ':reminder:' || extract(epoch from s.scheduled_at)::bigint || ':' || recipient.user_id
  from public.sessions s
  cross join lateral (values (s.mentor_id), (s.mentee_id)) as recipient(user_id)
  where s.status = 'scheduled'
    and s.scheduled_at > now() + interval '2 hours'
    and s.scheduled_at <= now() + interval '24 hours'
  on conflict (idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.enqueue_meeting_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_meeting_reminders() to service_role;
