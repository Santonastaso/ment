-- Read session topics as JSON when building evidence for a user's skills.
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
        and (
          exists (
            select 1
            from jsonb_array_elements_text(
              case when jsonb_typeof(s.topics) = 'array' then s.topics else '[]'::jsonb end
            ) topic(value)
            where lower(topic.value) = lower(sk.skill)
          )
          or lower(coalesce(s.pre_session_question, '')) like '%' || lower(sk.skill) || '%'
        )
    ) q
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_skill_evidence() from public, anon;
grant execute on function public.my_skill_evidence() to authenticated;
