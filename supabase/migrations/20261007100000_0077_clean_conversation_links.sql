-- Keep database identifiers out of user-facing conversation URLs.
alter table public.sessions add column if not exists route_token text;
alter table public.groups add column if not exists route_token text;

update public.sessions
set route_token = rtrim(translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_'), '=')
where route_token is null;

update public.groups
set route_token = rtrim(translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_'), '=')
where route_token is null;

alter table public.sessions alter column route_token set default rtrim(translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_'), '=');
alter table public.sessions alter column route_token set not null;
alter table public.groups alter column route_token set default rtrim(translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_'), '=');
alter table public.groups alter column route_token set not null;

create unique index if not exists sessions_route_token_idx on public.sessions(route_token);
create unique index if not exists groups_route_token_idx on public.groups(route_token);

create or replace function public.session_payload(p_session public.sessions, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p_session.id, 'route_token', p_session.route_token, 'mentor_id', p_session.mentor_id, 'mentee_id', p_session.mentee_id,
    'connection_id', p_session.connection_id, 'title', p_session.title,
    'scheduled_at', p_session.scheduled_at, 'duration_minutes', p_session.duration_minutes,
    'status', p_session.status, 'pre_session_question', p_session.pre_session_question,
    'outbound_message', p_session.outbound_message, 'meeting_url', p_session.meeting_url,
    'follow_up_intent', p_session.follow_up_intent, 'accepted_at', p_session.accepted_at,
    'occurred_at', p_session.occurred_at, 'last_activity_at', p_session.last_activity_at,
    'reflection', case when p_session.mentee_id = p_viewer then p_session.reflection else '' end,
    'mentor_reflection', case when p_session.mentor_id = p_viewer then p_session.mentor_reflection else '' end,
    'mentee_rating', case when p_session.mentee_id = p_viewer then p_session.mentee_rating else null end,
    'mentor_rating', case when p_session.mentor_id = p_viewer then p_session.mentor_rating else null end,
    'mentee_completed_at', p_session.mentee_completed_at,
    'mentor_completed_at', p_session.mentor_completed_at,
    'mentee_acknowledged_at', p_session.mentee_acknowledged_at,
    'topics', p_session.topics, 'created_at', p_session.created_at
  );
$$;

create or replace function public.my_session_relationships()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'person_id', case when s.mentor_id = caller then s.mentee_id else s.mentor_id end,
      'session_id', s.id, 'session_token', s.route_token, 'status', s.status, 'updated_at', s.last_activity_at
    )) from (
      select distinct on (least(mentor_id, mentee_id), greatest(mentor_id, mentee_id)) *
      from public.sessions where caller in (mentor_id, mentee_id)
      order by least(mentor_id, mentee_id), greatest(mentor_id, mentee_id), last_activity_at desc
    ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'route_token', g.route_token, 'name', g.name, 'description', g.description, 'created_at', g.created_at,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
    'joined', membership.user_id is not null,
    'is_owner', g.created_by = auth.uid(),
    'join_status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
    'join_expires_at', r.expires_at,
    'pending_count', case when g.created_by = auth.uid() then
      (select count(*) from public.group_join_requests q where q.group_id = g.id and q.status = 'pending' and q.expires_at > now()) else 0 end,
    'latest_message', latest.body
  ) order by lower(g.name), g.id), '[]'::jsonb)
  from public.groups g join public.profiles p on p.organization_id = g.organization_id
    and p.id = auth.uid() and p.admin_scope = 'none' and p.deactivated_at is null
  left join public.group_members membership on membership.group_id = g.id and membership.user_id = auth.uid()
  left join public.group_join_requests r on r.group_id = g.id and r.user_id = auth.uid()
  left join lateral (
    select m.body from public.group_messages m where m.group_id = g.id and membership.user_id is not null
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
$$;

create or replace function public.create_group(p_name text, p_description text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_user uuid := auth.uid(); v_org uuid; v_group public.groups;
begin
  select organization_id into v_org from public.profiles
  where id = v_user and admin_scope = 'none' and deactivated_at is null;
  if v_org is null then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required'; end if;
  insert into public.groups (organization_id, name, description, created_by)
  values (v_org, trim(p_name), left(coalesce(p_description, ''), 280), v_user)
  returning * into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group.id, v_user, 'owner');
  return jsonb_build_object('id', v_group.id, 'route_token', v_group.route_token, 'name', v_group.name);
end;
$function$;

grant execute on function public.my_session_relationships(), public.my_groups(), public.create_group(text, text) to authenticated;
