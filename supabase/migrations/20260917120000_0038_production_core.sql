-- Production-readiness foundation: invitations, connection safeguards,
-- realtime conversations, group chat, calendar providers, and skill evidence.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Secure, single-use organization invitations.
-- Raw tokens are returned once by the Edge Function; only their hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  profile_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists invitations_open_email_org
  on public.invitations (organization_id, lower(email))
  where status = 'pending';
create index if not exists invitations_org_created
  on public.invitations (organization_id, created_at desc);

alter table public.invitations enable row level security;
revoke all on public.invitations from public, anon, authenticated;
grant select on public.invitations to authenticated;
grant all on public.invitations to service_role;

drop policy if exists invitations_admin_read on public.invitations;
create policy invitations_admin_read on public.invitations for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.admin_scope = 'platform' or (p.admin_scope = 'org' and p.organization_id = invitations.organization_id))
  )
);

create or replace function public.my_invitations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'email', i.email,
    'profile_data', i.profile_data,
    'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    'expires_at', i.expires_at,
    'accepted_at', i.accepted_at,
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  from public.invitations i
  join public.profiles caller on caller.id = auth.uid()
  where caller.admin_scope in ('org', 'platform')
    and (caller.admin_scope = 'platform' or i.organization_id = caller.organization_id)
$$;
revoke all on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

-- Preserve source provenance for ESSEC or other institution-managed records.
alter table public.profiles
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists source_synced_at timestamptz;

create unique index if not exists profiles_external_identity
  on public.profiles (organization_id, external_source, external_id)
  where external_source is not null and external_id is not null;

-- ---------------------------------------------------------------------------
-- Connection capacity. Pending requests and accepted conversations both
-- consume capacity; stale pending requests expire automatically.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists request_expires_at timestamptz;

update public.sessions
set request_expires_at = created_at + interval '7 days'
where status = 'pending' and request_expires_at is null;

alter table public.sessions
  alter column request_expires_at set default (now() + interval '7 days');

create index if not exists sessions_active_capacity_idx
  on public.sessions (mentor_id, status, created_at, request_expires_at);

create or replace function public.is_active_connection(p_session public.sessions)
returns boolean language sql stable set search_path = public as $$
  select p_session.status in ('scheduled', 'completed')
    or (p_session.status = 'pending' and coalesce(p_session.request_expires_at, p_session.created_at + interval '7 days') > now())
$$;

create or replace function public.is_currently_available_mentor(p_user_id uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    not p.mentorship_paused
    and (p.mentorship_unavailable_until is null or p.mentorship_unavailable_until <= current_date)
    and not exists (
      select 1 from public.mentorship_unavailable_periods up
      where up.user_id = p.id and current_date between up.start_date and up.end_date
    )
    and (
      select count(*) from public.sessions s
      where s.mentor_id = p.id
        and public.is_active_connection(s)
        and (
          (s.status = 'pending' and s.created_at >= date_trunc('week', now()))
          or (s.status in ('scheduled', 'completed') and s.accepted_at >= date_trunc('week', now()))
        )
    ) < p.weekly_meeting_limit
    and (
      select count(*) from public.sessions s
      where s.mentor_id = p.id and public.is_active_connection(s)
        and (
          (s.status = 'pending' and s.created_at >= date_trunc('month', now()))
          or (s.status in ('scheduled', 'completed') and s.accepted_at >= date_trunc('month', now()))
        )
    ) < p.monthly_meeting_limit,
    false
  )
  from public.profiles p where p.id = p_user_id
$$;
grant execute on function public.is_active_connection(public.sessions), public.is_currently_available_mentor(uuid) to authenticated;

create or replace function public.my_meeting_capacity()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller uuid := auth.uid(); weekly_limit integer; monthly_limit integer;
  weekly_booked integer; monthly_booked integer;
begin
  if caller is null then raise exception 'auth_required'; end if;
  select p.weekly_meeting_limit, p.monthly_meeting_limit into weekly_limit, monthly_limit
  from public.profiles p where p.id = caller;
  select count(*) into weekly_booked from public.sessions s
  where s.mentor_id = caller and public.is_active_connection(s)
    and (
      (s.status = 'pending' and s.created_at >= date_trunc('week', now()))
      or (s.status in ('scheduled', 'completed') and s.accepted_at >= date_trunc('week', now()))
    );
  select count(*) into monthly_booked from public.sessions s
  where s.mentor_id = caller and public.is_active_connection(s)
    and (
      (s.status = 'pending' and s.created_at >= date_trunc('month', now()))
      or (s.status in ('scheduled', 'completed') and s.accepted_at >= date_trunc('month', now()))
    );
  return jsonb_build_object(
    'weekly_limit', weekly_limit, 'monthly_limit', monthly_limit,
    'weekly_booked', weekly_booked, 'monthly_booked', monthly_booked,
    'available', weekly_booked < weekly_limit and monthly_booked < monthly_limit
  );
end;
$$;
revoke all on function public.my_meeting_capacity() from public, anon;
grant execute on function public.my_meeting_capacity() to authenticated;

create or replace function public.expire_pending_requests()
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.sessions
  set status = 'cancelled', last_activity_at = now()
  where status = 'pending'
    and coalesce(request_expires_at, created_at + interval '7 days') <= now();
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.expire_pending_requests() from public, anon, authenticated;

create or replace function public.reject_expired_session_acceptance()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'scheduled'
     and coalesce(old.request_expires_at, old.created_at + interval '7 days') <= now() then
    raise exception 'request_expired';
  end if;
  return new;
end;
$$;
drop trigger if exists reject_expired_session_acceptance on public.sessions;
create trigger reject_expired_session_acceptance
before update of status on public.sessions
for each row execute function public.reject_expired_session_acceptance();

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mt-expire-requests';
    perform cron.schedule('mt-expire-requests', '15 * * * *', 'select public.expire_pending_requests()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Read state and realtime support for one-to-one conversations.
-- ---------------------------------------------------------------------------
create table if not exists public.session_reads (
  session_id bigint not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.session_reads enable row level security;
revoke all on public.session_reads from public, anon, authenticated;
grant all on public.session_reads to service_role;

create or replace function public.mark_session_read(p_session_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.sessions s where s.id = p_session_id and auth.uid() in (s.mentor_id, s.mentee_id)
  ) then raise exception 'not_found'; end if;
  insert into public.session_reads(session_id, user_id, last_read_at)
  values (p_session_id, auth.uid(), now())
  on conflict (session_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;
revoke all on function public.mark_session_read(bigint) from public, anon;
grant execute on function public.mark_session_read(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Persistent group conversations.
-- ---------------------------------------------------------------------------
create table if not exists public.group_messages (
  id bigserial primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 6000),
  created_at timestamptz not null default now()
);
create index if not exists group_messages_thread on public.group_messages(group_id, created_at, id);
alter table public.group_messages enable row level security;
revoke all on public.group_messages from public, anon, authenticated;
grant select on public.group_messages to authenticated;
grant all on public.group_messages to service_role;

drop policy if exists group_messages_member_read on public.group_messages;
create policy group_messages_member_read on public.group_messages for select using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = group_messages.group_id and gm.user_id = auth.uid()
  )
);

create or replace function public.my_group_messages(p_group_id bigint, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at, q.id) from (
    select gm.id, gm.group_id, gm.sender_id, p.name as sender_name, gm.body, gm.created_at
    from public.group_messages gm join public.profiles p on p.id = gm.sender_id
    where gm.group_id = p_group_id
    order by gm.created_at desc, gm.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) q), '[]'::jsonb);
end;
$$;

create or replace function public.send_group_message(p_group_id bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.group_messages;
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 6000 then raise exception 'invalid_message'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  insert into public.group_messages(group_id, sender_id, body)
  values (p_group_id, auth.uid(), trim(p_body)) returning * into result;
  return to_jsonb(result) || jsonb_build_object('sender_name', (select name from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.my_group_messages(bigint, integer), public.send_group_message(bigint, text) from public, anon;
grant execute on function public.my_group_messages(bigint, integer), public.send_group_message(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Calendar connection metadata. Tokens are encrypted/decrypted only by the
-- calendar Edge Function and are never selectable by authenticated clients.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  token_ciphertext text not null,
  refresh_ciphertext text,
  token_expires_at timestamptz,
  provider_email text,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

update public.sessions
set meeting_url = null
where meeting_url like 'https://teams.microsoft.com/l/meetup-join/ment-demo-%';

create or replace function public.reject_demo_meeting_urls()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.meeting_url like 'https://teams.microsoft.com/l/meetup-join/ment-demo-%' then new.meeting_url := null; end if;
  return new;
end;
$$;
drop trigger if exists reject_demo_meeting_urls on public.sessions;
create trigger reject_demo_meeting_urls before insert or update of meeting_url on public.sessions
for each row execute function public.reject_demo_meeting_urls();
alter table public.calendar_connections enable row level security;
revoke all on public.calendar_connections from public, anon, authenticated;
grant all on public.calendar_connections to service_role;

create table if not exists public.calendar_events (
  id bigserial primary key,
  session_id bigint not null references public.sessions(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  external_event_id text not null,
  join_url text,
  html_url text,
  scheduled_for timestamptz,
  status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, provider)
);
alter table public.calendar_events add column if not exists scheduled_for timestamptz;
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public, anon, authenticated;
grant select on public.calendar_events to authenticated;
grant all on public.calendar_events to service_role;

drop policy if exists calendar_events_participant_read on public.calendar_events;
create policy calendar_events_participant_read on public.calendar_events for select using (
  exists (
    select 1 from public.sessions s
    where s.id = calendar_events.session_id and auth.uid() in (s.mentor_id, s.mentee_id)
  )
);

-- ---------------------------------------------------------------------------
-- Evidence behind a user's skill progress: who they met and when.
-- ---------------------------------------------------------------------------
create or replace function public.my_skill_evidence()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(q) order by q.occurred_at desc) from (
      select distinct
        sk.id as skill_id,
        sk.skill,
        s.id as session_id,
        peer.id as person_id,
        peer.name as person_name,
        coalesce(s.scheduled_at, s.accepted_at, s.created_at) as occurred_at
      from public.skills sk
      join public.sessions s on caller in (s.mentor_id, s.mentee_id) and s.status in ('scheduled', 'completed')
      join public.profiles peer on peer.id = case when s.mentor_id = caller then s.mentee_id else s.mentor_id end
      where sk.user_id = caller
        and (sk.skill = any(coalesce(s.topics, '{}'::text[])) or lower(s.pre_session_question) like '%' || lower(sk.skill) || '%')
    ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_skill_evidence() from public, anon;
grant execute on function public.my_skill_evidence() to authenticated;

-- Supabase Realtime requires tables in the publication. Duplicate additions
-- are ignored by checking publication membership first.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_messages') then
    alter publication supabase_realtime add table public.session_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions') then
    alter publication supabase_realtime add table public.sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages') then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;
