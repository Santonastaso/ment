-- Expired requests stop blocking immediately, independently of scheduled cleanup.
create or replace function public.pm_session_guard() returns trigger
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
    if exists(select 1 from public.sessions s where s.status in ('pending','scheduled') and public.is_active_connection(s)
      and least(s.mentor_id,s.mentee_id) = least(new.mentor_id,new.mentee_id)
      and greatest(s.mentor_id,s.mentee_id) = greatest(new.mentor_id,new.mentee_id)) then
      raise exception 'active_session_exists';
    end if;
    if recipient.role = 'alumnus' then
      if (select count(*) from public.sessions s where s.mentor_id = recipient.id
        and s.status = 'pending' and public.is_active_connection(s)) >= settings.pending_request_limit then
        raise exception 'recipient_pending_limit';
      end if;
      if (select count(*) from public.sessions where mentor_id = recipient.id and created_at > now() - interval '7 days') >= settings.incoming_request_limit then
        raise exception 'recipient_weekly_limit';
      end if;
      if exists(select 1 from public.sessions where mentor_id = recipient.id and mentee_id = sender.id
        and created_at > now() - make_interval(days => settings.request_cooldown_days)) then
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
end;
$$;
revoke all on function public.pm_session_guard() from public, anon, authenticated;

create or replace function public.request_session(
  p_mentor_id uuid, p_title text, p_scheduled_at timestamptz default null,
  p_duration_minutes int default 60, p_pre_session_question text default null,
  p_topics jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); caller_org uuid; mentor public.profiles;
  topics jsonb; result public.sessions;
begin
  if caller is null then raise exception 'auth_required'; end if;
  if p_mentor_id is null or p_mentor_id = caller then raise exception 'mentor_required'; end if;
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'title_required'; end if;
  if length(coalesce(p_pre_session_question, '')) > 6000 then raise exception 'question_too_long'; end if;
  select organization_id into caller_org from public.profiles where id = caller;
  select * into mentor from public.profiles where id = p_mentor_id;
  if mentor.id is null or mentor.deactivated_at is not null
    or mentor.organization_id is distinct from caller_org then raise exception 'mentor_not_available'; end if;
  if not public.is_currently_available_mentor(p_mentor_id) then raise exception 'mentor_paused'; end if;
  if exists (select 1 from public.sessions s where s.status in ('pending','scheduled') and public.is_active_connection(s)
    and ((s.mentor_id = p_mentor_id and s.mentee_id = caller)
      or (s.mentor_id = caller and s.mentee_id = p_mentor_id))) then
    raise exception 'active_session_exists';
  end if;
  topics := coalesce(p_topics, '[]'::jsonb);
  if jsonb_typeof(topics) <> 'array' then topics := '[]'::jsonb; end if;
  insert into public.sessions(mentor_id, mentee_id, title, scheduled_at, duration_minutes, pre_session_question, topics, status)
  values(p_mentor_id, caller, trim(p_title), p_scheduled_at,
    least(greatest(coalesce(p_duration_minutes, 60), 15), 240), coalesce(p_pre_session_question, ''), topics, 'pending')
  returning * into result;
  return public.session_payload(result, caller);
end;
$$;
