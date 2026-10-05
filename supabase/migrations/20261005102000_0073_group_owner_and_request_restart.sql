-- A group creator owns its approval queue and must remain a member.
insert into public.group_members(group_id, user_id)
select g.id, g.created_by from public.groups g
where g.created_by is not null
on conflict do nothing;

update public.group_join_requests r set status = 'withdrawn'
from public.groups g
where g.id = r.group_id and g.created_by = r.user_id and r.status = 'pending';

create or replace function public.leave_group(p_group_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.groups where id = p_group_id and created_by = auth.uid()) then
    raise exception 'group_owner_cannot_leave';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = auth.uid();
end;
$$;

create or replace function public.request_group_join(p_group_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.groups g join public.profiles p on p.organization_id = g.organization_id
    where g.id = p_group_id and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null)
    then raise exception 'not_allowed'; end if;
  perform 1 from public.groups where id = p_group_id for update;
  if exists (select 1 from public.groups where id = p_group_id and created_by = auth.uid())
    then raise exception 'group_owner_cannot_join'; end if;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid())
    then raise exception 'already_member'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'reason_required'; end if;
  if exists (select 1 from public.group_join_requests where group_id = p_group_id and user_id = auth.uid()
    and status = 'pending' and expires_at > now()) then raise exception 'request_pending'; end if;
  insert into public.group_join_requests(group_id, user_id, reason) values(p_group_id, auth.uid(), trim(p_reason))
  on conflict (group_id, user_id) do update set reason = excluded.reason, status = 'pending',
    created_at = now(), expires_at = now() + interval '7 days';
end;
$$;

create or replace function public.review_group_join(p_group_id bigint, p_user_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.groups g join public.profiles p on p.organization_id = g.organization_id
    where g.id = p_group_id and g.created_by = auth.uid() and p.id = auth.uid() and p.deactivated_at is null)
    then raise exception 'not_allowed'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot_review_self'; end if;
  perform 1 from public.group_join_requests where group_id = p_group_id and user_id = p_user_id
    and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'request_expired'; end if;
  if p_accept is null then raise exception 'decision_required'; end if;
  if p_accept then
    if not exists (select 1 from public.profiles p join public.groups g on g.organization_id = p.organization_id
      where p.id = p_user_id and g.id = p_group_id and p.admin_scope = 'none' and p.deactivated_at is null)
      then raise exception 'not_allowed'; end if;
    insert into public.group_members(group_id, user_id) values(p_group_id, p_user_id) on conflict do nothing;
  end if;
  update public.group_join_requests set status = case when p_accept then 'accepted' else 'declined' end
    where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- Closed requests remain in Messages, but do not consume the pair's cooldown
-- or weekly intake when the requester starts over.
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
        and status in ('pending','scheduled','completed')
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

create or replace function public.my_session_relationships()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'person_id', case when s.mentor_id = caller then s.mentee_id else s.mentor_id end,
      'session_id', s.id, 'status', s.status, 'updated_at', s.last_activity_at
    )) from (
      select distinct on (least(mentor_id, mentee_id), greatest(mentor_id, mentee_id)) *
      from public.sessions where caller in (mentor_id, mentee_id)
        and status in ('pending','scheduled') and public.is_active_connection(sessions)
      order by least(mentor_id, mentee_id), greatest(mentor_id, mentee_id), last_activity_at desc
    ) s
  ), '[]'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
