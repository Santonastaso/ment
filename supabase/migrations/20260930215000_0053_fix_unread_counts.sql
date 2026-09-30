-- Count unread conversations from the per-thread JSON objects.
create or replace function public.my_unread_message_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  session_unread jsonb;
  group_unread jsonb;
begin
  if caller is null then raise exception 'auth_required'; end if;

  select coalesce(jsonb_object_agg(unread.session_id::text, unread.message_count), '{}'::jsonb)
  into session_unread
  from (
    select m.session_id, count(*)::integer as message_count
    from public.session_messages m
    join public.sessions s on s.id = m.session_id
    left join public.session_reads r on r.session_id = m.session_id and r.user_id = caller
    where caller in (s.mentor_id, s.mentee_id)
      and m.sender_id <> caller
      and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    group by m.session_id
  ) unread;

  select coalesce(jsonb_object_agg(unread.group_id::text, unread.message_count), '{}'::jsonb)
  into group_unread
  from (
    select m.group_id, count(*)::integer as message_count
    from public.group_messages m
    join public.group_members gm on gm.group_id = m.group_id and gm.user_id = caller
    left join public.group_reads r on r.group_id = m.group_id and r.user_id = caller
    where m.sender_id <> caller
      and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    group by m.group_id
  ) unread;

  return jsonb_build_object(
    'sessions', (select count(*)::integer from jsonb_object_keys(session_unread)),
    'groups', (select count(*)::integer from jsonb_object_keys(group_unread)),
    'session_unread', session_unread,
    'group_unread', group_unread
  );
end;
$$;
