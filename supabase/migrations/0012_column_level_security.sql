-- Column-level security: stop leaking sensitive columns through direct
-- PostgREST queries. Table-level grants override column-level revokes, so we
-- first REVOKE the table-level SELECT and then GRANT SELECT explicitly on
-- the non-sensitive column allowlist.
--
-- Sensitive columns now blocked at the column-grant layer:
--   * sessions.reflection, mentor_reflection         (private feedback)
--   * sessions.mentee_rating, mentor_rating          (private ratings)
--   * profiles.shadow_role_response                  (shadow-role text)
--
-- Read paths for owners go through SECURITY DEFINER RPCs which run as
-- postgres and so can still see every column:
--   * my_profile()       — owner reads their own full row
--   * my_session(id)     — participant reads a single session (payload
--                            redacts the other party's reflection/rating)
--   * my_sessions()      — same, list form
--   * peer_profile(id)   — peer reads a redacted profile (no shadow text)

revoke select on public.sessions from anon, authenticated;
grant select (
  id, mentor_id, mentee_id, connection_id, title, scheduled_at,
  duration_minutes, status, pre_session_question, topics, created_at,
  mentee_completed_at, mentor_completed_at, mentee_acknowledged_at
) on public.sessions to authenticated;

revoke select on public.profiles from anon, authenticated;
grant select (
  id, name, department, seniority, job_title, tenure_years, location, bio,
  pending_checkin, manager_id, must_change_password, deactivated_at,
  onboarding_complete, is_admin, admin_scope, organization_id,
  mentorship_paused, mentorship_unavailable_until, mentorship_note,
  monthly_session_goal, created_at
) on public.profiles to authenticated;

-- New: my_profile() returns the FULL profile row including columns that are
-- now blocked from direct SELECT (currently just `shadow_role_response`).
create or replace function public.my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_row public.profiles;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  select * into v_row from public.profiles where id = v_caller;
  if v_row.id is null then return null; end if;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.my_profile() to authenticated;
