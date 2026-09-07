-- PM pages 1-3 and 9: private discovery history, reviewed requests and alumni capacity.
create table public.discovery_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null default 'New conversation' check (length(title) <= 200),
  intent text not null default 'one_off' check (intent in ('one_off','ongoing')),
  turns jsonb not null default '[]' check (jsonb_typeof(turns) = 'array' and octet_length(turns::text) <= 200000),
  selected_person_id uuid references public.profiles(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index discovery_threads_owner on public.discovery_threads(user_id, updated_at desc);
alter table public.discovery_threads enable row level security;
revoke all on public.discovery_threads from public, anon, authenticated;
grant select, insert, update, delete on public.discovery_threads to authenticated;
grant all on public.discovery_threads to service_role;
create policy discovery_own on public.discovery_threads for all to authenticated
using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null
  )
);

alter table public.organizations
  add column incoming_request_limit integer not null default 5 check (incoming_request_limit between 1 and 100),
  add column pending_request_limit integer not null default 3 check (pending_request_limit between 1 and 100),
  add column request_cooldown_days integer not null default 7 check (request_cooldown_days between 0 and 90);
alter table public.sessions
  add column idempotency_key uuid,
  add column follow_up_intent text not null default 'one_off' check (follow_up_intent in ('one_off','ongoing')),
  add column accepted_at timestamptz,
  add column occurred_at timestamptz;
create unique index sessions_request_key on public.sessions(mentee_id, idempotency_key) where idempotency_key is not null;
create index sessions_recipient_window on public.sessions(mentor_id, created_at desc);
-- Only verified occurrence timestamps are backfilled. Historical acceptance time stays unknown.
update public.sessions set occurred_at = coalesce(mentor_completed_at, mentee_completed_at)
where status = 'completed';

create function public.pm_session_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient public.profiles; sender public.profiles; settings public.organizations;
begin
  if TG_OP = 'INSERT' then
    select * into recipient from public.profiles where id = new.mentor_id for update;
    select * into sender from public.profiles where id = new.mentee_id;
    if recipient.id is null or sender.id is null or recipient.id = sender.id
      or recipient.organization_id is distinct from sender.organization_id
      or recipient.admin_scope <> 'none' or sender.admin_scope <> 'none'
      or recipient.deactivated_at is not null or sender.deactivated_at is not null then
      raise exception 'recipient_not_available';
    end if;
    if not public.is_currently_available_mentor(recipient.id) then raise exception 'mentor_paused'; end if;
    select * into settings from public.organizations where id = recipient.organization_id;
    if exists(select 1 from public.sessions s where s.status in ('pending','scheduled')
      and least(s.mentor_id,s.mentee_id)=least(new.mentor_id,new.mentee_id)
      and greatest(s.mentor_id,s.mentee_id)=greatest(new.mentor_id,new.mentee_id)) then
      raise exception 'active_session_exists';
    end if;
    if recipient.role = 'alumnus' then
      if (select count(*) from public.sessions where mentor_id = recipient.id and status = 'pending') >= settings.pending_request_limit then
        raise exception 'recipient_pending_limit';
      end if;
      if (select count(*) from public.sessions where mentor_id = recipient.id and created_at > now()-interval '7 days') >= settings.incoming_request_limit then
        raise exception 'recipient_weekly_limit';
      end if;
      if exists(select 1 from public.sessions where mentor_id=recipient.id and mentee_id=sender.id
        and created_at > now()-make_interval(days=>settings.request_cooldown_days)) then
        raise exception 'pair_cooldown';
      end if;
    end if;
  else
    if new.status in ('scheduled','completed') and old.status = 'pending' then
      new.accepted_at := coalesce(old.accepted_at, now());
    end if;
    if new.status = 'completed' and old.status <> 'completed' then
      new.occurred_at := coalesce(old.occurred_at, now());
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.pm_session_guard() from public, anon, authenticated;
create trigger pm_session_guard before insert or update on public.sessions for each row execute function public.pm_session_guard();

create function public.pm_request_session(
  p_mentor_id uuid, p_title text, p_scheduled_at timestamptz default null,
  p_duration_minutes integer default 60, p_pre_session_question text default '',
  p_topics jsonb default null, p_idempotency_key uuid default null,
  p_follow_up_intent text default 'one_off'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; existing public.sessions; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required'; end if;
  if p_follow_up_intent not in ('one_off','ongoing') then raise exception 'invalid_intent'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || p_idempotency_key::text, 0));
  select * into existing from public.sessions where mentee_id=caller and idempotency_key=p_idempotency_key;
  if found then
    if existing.mentor_id <> p_mentor_id then raise exception 'idempotency_conflict'; end if;
    return public.session_payload(existing,caller);
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then raise exception 'invalid_schedule'; end if;
  if char_length(trim(p_pre_session_question)) not between 1 and 500 then raise exception 'question_required'; end if;
  result := public.request_session(p_mentor_id,p_title,p_scheduled_at,p_duration_minutes,p_pre_session_question,p_topics);
  update public.sessions set idempotency_key=p_idempotency_key,follow_up_intent=p_follow_up_intent
    where id=(result->>'id')::bigint;
  return result;
end; $$;
revoke all on function public.pm_request_session(uuid,text,timestamptz,integer,text,jsonb,uuid,text) from public,anon;
grant execute on function public.pm_request_session(uuid,text,timestamptz,integer,text,jsonb,uuid,text) to authenticated;

create function public.pm_request_settings(p_weekly integer default null,p_pending integer default null,p_cooldown integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller uuid:=auth.uid(); org uuid; settings public.organizations;
begin
  if caller is null or not public.is_admin(caller) then raise exception 'admin_only'; end if;
  select organization_id into org from public.profiles where id=caller and deactivated_at is null;
  if org is null then raise exception 'not_allowed'; end if;
  if p_weekly is not null or p_pending is not null or p_cooldown is not null then
    update public.organizations set incoming_request_limit=coalesce(p_weekly,incoming_request_limit),
      pending_request_limit=coalesce(p_pending,pending_request_limit),request_cooldown_days=coalesce(p_cooldown,request_cooldown_days)
    where id=org;
    insert into public.audit_logs(actor_id,action,target_type,target_id)
    values(caller,'request_limits_updated','organization',org::text);
  end if;
  select * into settings from public.organizations where id=org;
  return jsonb_build_object('weekly',settings.incoming_request_limit,'pending',settings.pending_request_limit,'cooldown',settings.request_cooldown_days);
end; $$;
revoke all on function public.pm_request_settings(integer,integer,integer) from public,anon;
grant execute on function public.pm_request_settings(integer,integer,integer) to authenticated;

create function public.pm_evidence_limit() returns trigger language plpgsql as $$
begin
  if TG_OP='INSERT' or new.example_project is distinct from old.example_project then
    if char_length(new.example_project)>80 then raise exception 'example_too_long'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.pm_evidence_limit() from public,anon,authenticated;
create trigger pm_evidence_limit before insert or update on public.skills for each row execute function public.pm_evidence_limit();

create table public.feedback_delivery (
  feedback_id bigint primary key references public.feedback_messages(id) on delete cascade,
  status text not null default 'demo' check(status in ('demo','queued','sent','failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);
alter table public.feedback_delivery enable row level security;
revoke all on public.feedback_delivery from public,anon,authenticated;
grant all on public.feedback_delivery to service_role;
grant select on public.feedback_delivery to authenticated;
create policy feedback_delivery_admin on public.feedback_delivery for select to authenticated using (
  public.is_admin(auth.uid()) and exists(select 1 from public.feedback_messages f where f.id=feedback_id
    and (public.is_platform_admin(auth.uid()) or f.organization_id=public.current_organization_id(auth.uid())))
);
create function public.pm_feedback_enqueue() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.feedback_delivery(feedback_id) values(new.id) on conflict do nothing;
  return new;
end; $$;
revoke all on function public.pm_feedback_enqueue() from public,anon,authenticated;
create trigger pm_feedback_enqueue after insert on public.feedback_messages for each row execute function public.pm_feedback_enqueue();
insert into public.feedback_delivery(feedback_id) select id from public.feedback_messages on conflict do nothing;
