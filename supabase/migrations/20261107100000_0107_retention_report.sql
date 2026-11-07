-- Preview the exact database rows eligible for retention without mutating them.
-- The service role uses this before an operator enables or applies retention.
create or replace function public.report_data_retention()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.retention_settings; n integer;
  organizations integer := 0; messages integer := 0; sessions_cleared integer := 0;
  searches integer := 0; reflections integer := 0; audit integer := 0;
  drafts integer := 0; notifications integer := 0; ai_runs integer := 0;
  outreach integer := 0; invitations integer := 0; benefits integer := 0;
  accounts integer := 0; auth_cleanup integer := 0;
begin
  for s in select * from public.retention_settings loop
    organizations := organizations + 1;
    if s.conversation_days is not null then
      select count(*)::integer into n
        from public.session_messages m join public.sessions x on x.id = m.session_id
        join public.profiles p on p.id = x.mentor_id
        where p.organization_id = s.organization_id
          and m.created_at < now() - make_interval(days => s.conversation_days);
      messages := messages + n;
      select count(*)::integer into n
        from public.group_messages m join public.groups g on g.id = m.group_id
        where g.organization_id = s.organization_id
          and m.created_at < now() - make_interval(days => s.conversation_days);
      messages := messages + n;
      select count(*)::integer into n
        from public.sessions x join public.profiles p on p.id = x.mentor_id
        where p.organization_id = s.organization_id
          and x.status not in ('pending', 'scheduled')
          and x.last_activity_at < now() - make_interval(days => s.conversation_days)
          and (coalesce(x.outbound_message, '') <> '' or x.pre_session_question <> ''
            or x.reflection <> '' or x.mentor_reflection <> '');
      sessions_cleared := sessions_cleared + n;
    end if;
    if s.search_days is not null then
      select count(*)::integer into n from public.discovery_threads t
        join public.profiles p on p.id = t.user_id
        where p.organization_id = s.organization_id
          and t.updated_at < now() - make_interval(days => s.search_days);
      searches := searches + n;
    end if;
    if s.reflection_days is not null then
      select count(*)::integer into n from public.reflection_logs r
        join public.profiles p on p.id = r.user_id
        where p.organization_id = s.organization_id
          and r.created_at < now() - make_interval(days => s.reflection_days);
      reflections := reflections + n;
    end if;
    if s.audit_log_days is not null then
      select count(*)::integer into n from public.audit_logs a
        join public.profiles p on p.id = a.actor_id
        where p.organization_id = s.organization_id
          and a.created_at < now() - make_interval(days => s.audit_log_days);
      audit := audit + n;
    end if;
    if s.profile_draft_days is not null then
      select count(*)::integer into n from public.profile_drafts d
        join public.profiles p on p.id = d.user_id
        where p.organization_id = s.organization_id
          and d.created_at < now() - make_interval(days => s.profile_draft_days);
      drafts := drafts + n;
    end if;
    if s.notification_days is not null then
      select count(*)::integer into n from public.notification_outbox o
        join public.profiles p on p.id = o.user_id
        where p.organization_id = s.organization_id and o.status in ('sent', 'failed')
          and o.created_at < now() - make_interval(days => s.notification_days);
      notifications := notifications + n;
    end if;
    if s.ai_telemetry_days is not null then
      select count(*)::integer into n from public.ai_runs a
        where a.organization_id = s.organization_id
          and a.created_at < now() - make_interval(days => s.ai_telemetry_days);
      ai_runs := ai_runs + n;
    end if;
    if s.outreach_days is not null then
      select count(*)::integer into n from public.outreach_targets o
        where o.organization_id = s.organization_id
          and o.created_at < now() - make_interval(days => s.outreach_days);
      outreach := outreach + n;
    end if;
    if s.invitation_days is not null then
      select count(*)::integer into n from public.invitations i
        where i.organization_id = s.organization_id
          and (i.status <> 'pending' or i.expires_at < now())
          and i.created_at < now() - make_interval(days => s.invitation_days);
      invitations := invitations + n;
    end if;
    if s.meeting_benefit_days is not null then
      select count(*)::integer into n from public.meeting_benefits b
        join public.profiles p on p.id = b.user_id
        where p.organization_id = s.organization_id
          and b.created_at < now() - make_interval(days => s.meeting_benefit_days);
      benefits := benefits + n;
    end if;
  end loop;
  select count(*)::integer into accounts from public.profiles p
    join public.retention_settings r on r.organization_id = p.organization_id
    where r.deactivated_account_days is not null and p.admin_scope = 'none' and not p.is_admin
      and p.erased_at is null
      and p.deactivated_at < now() - make_interval(days => r.deactivated_account_days);
  select count(*)::integer into auth_cleanup from public.account_erasure_auth_cleanup;
  return jsonb_build_object(
    'organizations_configured', organizations, 'messages', messages,
    'sessions_cleared', sessions_cleared, 'searches', searches,
    'reflections', reflections, 'audit_logs', audit, 'profile_drafts', drafts,
    'notifications', notifications, 'ai_runs', ai_runs,
    'outreach_targets', outreach, 'invitations', invitations,
    'meeting_benefits', benefits, 'accounts_eligible', accounts,
    'auth_cleanup_pending', auth_cleanup);
end $$;

revoke all on function public.report_data_retention() from public, anon, authenticated;
grant execute on function public.report_data_retention() to service_role;

notify pgrst, 'reload schema';
