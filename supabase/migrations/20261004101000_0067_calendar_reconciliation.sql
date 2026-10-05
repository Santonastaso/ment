create table public.calendar_sync_jobs (
  session_id bigint primary key references public.sessions(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sending', 'failed')),
  generation bigint not null default 1,
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);
create index calendar_sync_jobs_due on public.calendar_sync_jobs(next_attempt_at)
  where status = 'queued';
alter table public.calendar_sync_jobs enable row level security;
revoke all on public.calendar_sync_jobs from public, anon, authenticated;
grant all on public.calendar_sync_jobs to service_role;

create function public.enqueue_calendar_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status or new.scheduled_at is distinct from old.scheduled_at)
    and exists (select 1 from public.calendar_events where session_id = new.id) then
    insert into public.calendar_sync_jobs(session_id) values (new.id)
    on conflict (session_id) do update set
      status = 'queued', generation = calendar_sync_jobs.generation + 1,
      attempts = 0, claimed_at = null, next_attempt_at = now(),
      last_error = null, updated_at = now();
  end if;
  return null;
end;
$$;
create trigger session_calendar_sync
after update of status, scheduled_at on public.sessions
for each row execute function public.enqueue_calendar_sync();

create function public.enqueue_new_calendar_event_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_session public.sessions%rowtype;
begin
  select * into current_session from public.sessions where id = new.session_id;
  if current_session.status in ('cancelled', 'declined', 'expired')
    or (current_session.status = 'scheduled'
      and new.scheduled_for is distinct from current_session.scheduled_at) then
    insert into public.calendar_sync_jobs(session_id) values (new.session_id)
    on conflict (session_id) do update set
      status = 'queued', generation = calendar_sync_jobs.generation + 1,
      attempts = 0, claimed_at = null, next_attempt_at = now(),
      last_error = null, updated_at = now();
  end if;
  return null;
end;
$$;
create trigger calendar_event_drift
after insert or update of scheduled_for on public.calendar_events
for each row execute function public.enqueue_new_calendar_event_sync();

create function public.claim_calendar_sync_jobs(p_limit integer default 20)
returns table(session_id bigint, generation bigint, attempts integer)
language sql security definer set search_path = public as $$
  update public.calendar_sync_jobs j
  set status = 'sending', claimed_at = now(), attempts = j.attempts + 1, updated_at = now()
  from (
    select due.session_id from public.calendar_sync_jobs due
    where (due.status = 'queued' and due.next_attempt_at <= now())
       or (due.status = 'sending' and due.claimed_at < now() - interval '15 minutes')
    order by due.next_attempt_at, due.session_id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ) picked
  where j.session_id = picked.session_id
  returning j.session_id, j.generation, j.attempts;
$$;
revoke all on function public.claim_calendar_sync_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_calendar_sync_jobs(integer) to service_role;

create table public.calendar_event_claims (
  session_id bigint not null references public.sessions(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lease_token uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (session_id, provider)
);
alter table public.calendar_event_claims enable row level security;
revoke all on public.calendar_event_claims from public, anon, authenticated;
grant all on public.calendar_event_claims to service_role;

create function public.claim_calendar_event(p_session_id bigint, p_provider text, p_owner_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare token uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  insert into public.calendar_event_claims(session_id, provider, owner_id, lease_token)
  values (p_session_id, p_provider, p_owner_id, token)
  on conflict (session_id, provider) do update set
    lease_token = excluded.lease_token, claimed_at = now()
  where calendar_event_claims.owner_id = excluded.owner_id
    and calendar_event_claims.claimed_at < now() - interval '2 minutes'
  returning lease_token into token;
  return token;
end;
$$;
revoke all on function public.claim_calendar_event(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_calendar_event(bigint, text, uuid) to service_role;

-- Pick up drift that predated the job table.
insert into public.calendar_sync_jobs(session_id)
select distinct e.session_id from public.calendar_events e
join public.sessions s on s.id = e.session_id
where s.status in ('cancelled', 'declined', 'expired')
   or (s.status = 'scheduled' and e.scheduled_for is distinct from s.scheduled_at)
on conflict do nothing;
