-- Move the last direct-table write on public.sessions behind a
-- security-definer RPC.
--
-- The client had one field-only `PUT /sessions/:id` path that did
-- `supabase.from('sessions').update({...})` directly to persist a
-- reflection / rating after the fact (i.e. without going through
-- complete_session). Two problems with that:
--   1. There is no UPDATE RLS policy on public.sessions (it was dropped in
--      0006 and never restored), so the write relied purely on the table
--      grant — inconsistent with every other session mutation.
--   2. After 0012 revoked column SELECT on reflection/rating, the trailing
--      `.select()` on that update would try to read back locked columns.
--
-- This RPC enforces participant-only access and role-scoped writes: the
-- mentor can only touch mentor_reflection / mentor_rating, the mentee only
-- reflection / mentee_rating. It never changes status or completion
-- timestamps — that stays the job of complete_session.

create or replace function public.update_session_feedback(
  p_session_id bigint,
  p_reflection text default null,
  p_rating int default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
  v_is_mentor boolean;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then
    raise exception 'forbidden';
  end if;
  v_is_mentor := v_session.mentor_id = v_caller;

  if v_is_mentor then
    update public.sessions
       set mentor_reflection = coalesce(p_reflection, mentor_reflection),
           mentor_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentor_rating)
     where id = p_session_id;
  else
    update public.sessions
       set reflection = coalesce(p_reflection, reflection),
           mentee_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentee_rating)
     where id = p_session_id;
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  return v_session;
end;
$$;

grant execute on function public.update_session_feedback(bigint, text, int) to authenticated;
