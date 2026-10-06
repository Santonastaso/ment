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
        and status in ('pending','scheduled') and public.is_active_connection(sessions)
      order by least(mentor_id, mentee_id), greatest(mentor_id, mentee_id), last_activity_at desc
    ) s
  ), '[]'::jsonb);
end;
$$;
