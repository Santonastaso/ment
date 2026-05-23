-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.profile_drafts enable row level security;
alter table public.career_history enable row level security;
alter table public.skills enable row level security;
alter table public.connections enable row level security;
alter table public.sessions enable row level security;
alter table public.match_scores enable row level security;
alter table public.audit_logs enable row level security;
alter table public.reflection_logs enable row level security;

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- inserts only by trigger / service_role; deletes blocked

-- ---- skills ----
drop policy if exists skills_select on public.skills;
create policy skills_select on public.skills
  for select to authenticated using (true);

drop policy if exists skills_modify_own on public.skills;
create policy skills_modify_own on public.skills
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- career_history ----
drop policy if exists career_select on public.career_history;
create policy career_select on public.career_history
  for select to authenticated using (true);

drop policy if exists career_modify_own on public.career_history;
create policy career_modify_own on public.career_history
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- connections ----
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections
  for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- writes go through public.upsert_connection / update_connection_status
-- (security definer). Direct writes from anon/authenticated denied.

-- ---- sessions ----
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (auth.uid() in (mentor_id, mentee_id));

-- writes go through request_session / accept_session / complete_session /
-- cancel_session / reschedule_session

-- ---- match_scores ----
drop policy if exists matches_select on public.match_scores;
create policy matches_select on public.match_scores
  for select to authenticated
  using (auth.uid() in (user_a_id, user_b_id));

-- writes only via recompute_matches_for / triggers

-- ---- audit_logs ----
drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- writes only via triggers / admin functions

-- ---- reflection_logs ----
drop policy if exists reflections_own on public.reflection_logs;
create policy reflections_own on public.reflection_logs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- profile_drafts ----
drop policy if exists drafts_own on public.profile_drafts;
create policy drafts_own on public.profile_drafts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Function execute grants (revoke from public, grant to authenticated)
-- ---------------------------------------------------------------------

revoke all on function
  public.skill_progress_for(uuid),
  public.expertise_signature_for(uuid),
  public.badges_for(uuid),
  public.team_skill_gaps(uuid),
  public.compute_session_topics(uuid, uuid),
  public.request_session(uuid, text, timestamptz, int, text, jsonb),
  public.accept_session(bigint, timestamptz),
  public.cancel_session(bigint, text),
  public.complete_session(bigint, text, int),
  public.reschedule_session(bigint, timestamptz),
  public.upsert_connection(uuid, text),
  public.update_connection_status(bigint, text),
  public.apply_reflection(bigint, jsonb, jsonb),
  public.recompute_matches_for(uuid),
  public.recompute_all_matches(),
  public.is_mentor_leaning(jsonb, uuid, uuid),
  public.get_matches_for(text, int, int),
  public.save_onboarding(text, text, text, text, text, text, int, text, jsonb, jsonb, jsonb),
  public.admin_stats(),
  public.admin_users(int, int),
  public.admin_audit(int),
  public.admin_set_manager(uuid, text),
  public.admin_deactivate(uuid),
  public.admin_broadcast_checkin(),
  public.acknowledge_checkin(),
  public.complete_password_change()
from public;

grant execute on function
  public.skill_progress_for(uuid),
  public.expertise_signature_for(uuid),
  public.badges_for(uuid),
  public.team_skill_gaps(uuid),
  public.request_session(uuid, text, timestamptz, int, text, jsonb),
  public.accept_session(bigint, timestamptz),
  public.cancel_session(bigint, text),
  public.complete_session(bigint, text, int),
  public.reschedule_session(bigint, timestamptz),
  public.upsert_connection(uuid, text),
  public.update_connection_status(bigint, text),
  public.apply_reflection(bigint, jsonb, jsonb),
  public.get_matches_for(text, int, int),
  public.save_onboarding(text, text, text, text, text, text, int, text, jsonb, jsonb, jsonb),
  public.admin_stats(),
  public.admin_users(int, int),
  public.admin_audit(int),
  public.admin_set_manager(uuid, text),
  public.admin_deactivate(uuid),
  public.admin_broadcast_checkin(),
  public.acknowledge_checkin(),
  public.complete_password_change()
to authenticated;
