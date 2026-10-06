-- A completed meeting must not impose the request cooldown on another meeting.
-- Pending/scheduled requests and the organization's intake limits still apply.
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
      if (select count(*) from public.sessions where mentor_id = recipient.id
        and status in ('pending','scheduled','completed')
        and created_at > now() - interval '7 days') >= settings.incoming_request_limit then
        raise exception 'recipient_weekly_limit';
      end if;
      if exists(select 1 from public.sessions where mentor_id = recipient.id and mentee_id = sender.id
        and status in ('pending','scheduled')
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
