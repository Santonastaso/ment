-- Start email delivery with transactional messages only. Weekly reflection
-- email remains available, but members must explicitly opt in after launch.
alter table public.profiles
  alter column reflection_email_reminders set default false;

update public.profiles
set reflection_email_reminders = false
where reflection_email_reminders;

-- Establish a hard activation boundary: no notification created before this
-- migration may ever be delivered. Keep the rows as an audit trail.
update public.notification_outbox
set status = 'failed', claimed_at = null, last_error = 'retired_before_activation'
where status in ('queued', 'sending');

-- Queue one privacy-preserving email per direct message. The worker checks
-- that the message is still unread before sending and never includes its body.
create or replace function public.enqueue_session_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
begin
  if new.kind <> 'message' then return new; end if;

  select case
    when new.sender_id = s.mentor_id then s.mentee_id
    when new.sender_id = s.mentee_id then s.mentor_id
    else null
  end
  into recipient
  from public.sessions s
  where s.id = new.session_id;

  if recipient is null or not exists (
    select 1 from public.profiles p
    where p.id = recipient and p.deactivated_at is null
  ) then return new; end if;

  insert into public.notification_outbox(user_id, channel, topic, payload, idempotency_key)
  values (
    recipient,
    'email',
    'session_message_received',
    jsonb_build_object('session_id', new.session_id, 'message_id', new.id),
    'session-message:' || new.id
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_session_message_notification() from public, anon, authenticated;

drop trigger if exists enqueue_session_message_notification on public.session_messages;
create trigger enqueue_session_message_notification
after insert on public.session_messages
for each row execute function public.enqueue_session_message_notification();
