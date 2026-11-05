-- Complete the member export with the caller's identity and linked operational records.
-- Select fields explicitly so secrets, audit payloads, and future content columns stay out.

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth_required'; end if;
  return jsonb_build_object(
    'format', 'ment-export-1',
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = me),
    'auth_account', (select jsonb_build_object('email', u.email) from auth.users u where u.id = me),
    'skills', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.skills x where x.user_id = me),
    'career_history', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.career_history x where x.user_id = me),
    'profile_drafts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.profile_drafts x where x.user_id = me),
    'reflections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.reflection_logs x where x.user_id = me),
    'unavailable_periods', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.mentorship_unavailable_periods x where x.user_id = me),
    'connections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.connections x where me in (x.requester_id, x.addressee_id)),
    'sessions', (select coalesce(jsonb_agg(
        to_jsonb(s) - 'route_token' - (case when s.mentor_id = me
          then array['reflection', 'mentee_rating'] else array['mentor_reflection', 'mentor_rating'] end)
        order by s.id), '[]')
      from public.sessions s where me in (s.mentor_id, s.mentee_id)),
    'session_messages_sent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.session_messages x where x.sender_id = me),
    'groups_created', (select coalesce(jsonb_agg(to_jsonb(x) - 'route_token' order by x.id), '[]') from public.groups x where x.created_by = me),
    'group_memberships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_members x where x.user_id = me),
    'group_join_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_join_requests x where x.user_id = me),
    'group_messages_sent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.group_messages x where x.sender_id = me),
    'discovery_threads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.discovery_threads x where x.user_id = me),
    'discovery_feedback', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.discovery_feedback x where x.user_id = me),
    'feedback', (select coalesce(jsonb_agg(to_jsonb(x) - 'reviewed_by'), '[]') from public.feedback_messages x where x.user_id = me),
    'continuation_intents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.continuation_intents x where x.user_id = me),
    'outcome_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.outcome_events x where x.actor_id = me),
    'calendar_connections', (select coalesce(jsonb_agg(to_jsonb(x) - 'token_ciphertext' - 'refresh_ciphertext'), '[]') from public.calendar_connections x where x.user_id = me),
    'calendar_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.calendar_events x where x.owner_id = me),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.notification_outbox x where x.user_id = me),
    'consents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.accepted_at), '[]') from public.consent_records x where x.user_id = me),
    'meeting_benefits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.meeting_benefits x where x.user_id = me),
    'ai_runs', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'user_id', x.user_id, 'organization_id', x.organization_id,
      'feature', x.feature, 'prompt_version', x.prompt_version, 'model', x.model,
      'status', x.status, 'latency_ms', x.latency_ms, 'error_code', x.error_code,
      'created_at', x.created_at) order by x.id), '[]'::jsonb)
      from public.ai_runs x where x.user_id = me),
    'audit_actions', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'action', x.action, 'created_at', x.created_at) order by x.id), '[]'::jsonb)
      from public.audit_logs x where x.actor_id = me),
    'accepted_invitations', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'organization_id', x.organization_id, 'email', x.email,
      'profile_data', x.profile_data, 'status', x.status, 'expires_at', x.expires_at,
      'accepted_at', x.accepted_at, 'created_at', x.created_at) order by x.id), '[]'::jsonb)
      from public.invitations x where x.accepted_user_id = me and x.status = 'accepted'),
    'outreach_targets', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'organization_id', x.organization_id, 'profile_id', x.profile_id,
      'email', x.email, 'persona', x.persona, 'cohort_term', x.cohort_term,
      'invited_at', x.invited_at, 'is_demo', x.is_demo, 'created_at', x.created_at) order by x.id), '[]'::jsonb)
      from public.outreach_targets x where x.profile_id = me)
  );
end $$;
revoke all on function public.export_my_data() from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
