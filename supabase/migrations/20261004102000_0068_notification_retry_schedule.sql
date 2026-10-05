alter table public.notification_outbox
  add column next_attempt_at timestamptz not null default now(),
  add column last_error text;
create index notification_outbox_due on public.notification_outbox(next_attempt_at, created_at)
  where status = 'queued';
