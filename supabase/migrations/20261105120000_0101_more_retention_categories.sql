-- Give each controller an optional period for the remaining operational data.
-- NULL still means no automated deletion; this migration sets no periods.
alter table public.retention_settings
  add column profile_draft_days integer check (profile_draft_days between 30 and 3650),
  add column notification_days integer check (notification_days between 30 and 3650),
  add column ai_telemetry_days integer check (ai_telemetry_days between 30 and 3650),
  add column outreach_days integer check (outreach_days between 30 and 3650),
  add column invitation_days integer check (invitation_days between 30 and 3650),
  add column meeting_benefit_days integer check (meeting_benefit_days between 30 and 3650);

create or replace function public.admin_retention_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.current_organization_id(auth.uid()); row public.retention_settings;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin_only'; end if;
  select * into row from public.retention_settings where organization_id = v_org;
  return jsonb_build_object(
    'conversation_days', row.conversation_days, 'search_days', row.search_days,
    'reflection_days', row.reflection_days, 'audit_log_days', row.audit_log_days,
    'deactivated_account_days', row.deactivated_account_days,
    'profile_draft_days', row.profile_draft_days, 'notification_days', row.notification_days,
    'ai_telemetry_days', row.ai_telemetry_days, 'outreach_days', row.outreach_days,
    'invitation_days', row.invitation_days, 'meeting_benefit_days', row.meeting_benefit_days,
    'updated_at', row.updated_at);
end $$;

create or replace function public.admin_set_retention_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_organization_id(auth.uid());
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin_only'; end if;
  if v_org is null then raise exception 'organization_required'; end if;
  insert into public.retention_settings (organization_id, conversation_days, search_days, reflection_days,
    audit_log_days, deactivated_account_days, profile_draft_days, notification_days,
    ai_telemetry_days, outreach_days, invitation_days, meeting_benefit_days, updated_at, updated_by)
  values (v_org,
    nullif(p_settings->>'conversation_days', '')::integer, nullif(p_settings->>'search_days', '')::integer,
    nullif(p_settings->>'reflection_days', '')::integer, nullif(p_settings->>'audit_log_days', '')::integer,
    nullif(p_settings->>'deactivated_account_days', '')::integer,
    nullif(p_settings->>'profile_draft_days', '')::integer, nullif(p_settings->>'notification_days', '')::integer,
    nullif(p_settings->>'ai_telemetry_days', '')::integer, nullif(p_settings->>'outreach_days', '')::integer,
    nullif(p_settings->>'invitation_days', '')::integer, nullif(p_settings->>'meeting_benefit_days', '')::integer,
    now(), auth.uid())
  on conflict (organization_id) do update set
    conversation_days = excluded.conversation_days, search_days = excluded.search_days,
    reflection_days = excluded.reflection_days, audit_log_days = excluded.audit_log_days,
    deactivated_account_days = excluded.deactivated_account_days,
    profile_draft_days = excluded.profile_draft_days, notification_days = excluded.notification_days,
    ai_telemetry_days = excluded.ai_telemetry_days, outreach_days = excluded.outreach_days,
    invitation_days = excluded.invitation_days, meeting_benefit_days = excluded.meeting_benefit_days,
    updated_at = now(), updated_by = auth.uid();
  return public.admin_retention_settings();
end $$;

create or replace function public.run_data_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.retention_settings; n integer;
  messages integer := 0; sessions_cleared integer := 0; searches integer := 0;
  reflections integer := 0; audit integer := 0;
  drafts integer := 0; notifications integer := 0; ai_runs integer := 0;
  outreach integer := 0; invitations integer := 0; benefits integer := 0;
begin
  for s in select * from public.retention_settings loop
    if s.conversation_days is not null then
      delete from public.session_messages m using public.sessions x, public.profiles p
        where m.session_id = x.id and p.id = x.mentor_id and p.organization_id = s.organization_id
          and m.created_at < now() - make_interval(days => s.conversation_days);
      get diagnostics n = row_count; messages := messages + n;
      delete from public.group_messages m using public.groups g
        where m.group_id = g.id and g.organization_id = s.organization_id
          and m.created_at < now() - make_interval(days => s.conversation_days);
      get diagnostics n = row_count; messages := messages + n;
      update public.sessions x set outbound_message = '', pre_session_question = '', reflection = '', mentor_reflection = ''
        from public.profiles p
        where p.id = x.mentor_id and p.organization_id = s.organization_id
          and x.status not in ('pending', 'scheduled')
          and x.last_activity_at < now() - make_interval(days => s.conversation_days)
          and (coalesce(x.outbound_message, '') <> '' or x.pre_session_question <> '' or x.reflection <> '' or x.mentor_reflection <> '');
      get diagnostics n = row_count; sessions_cleared := sessions_cleared + n;
    end if;
    if s.search_days is not null then
      delete from public.discovery_threads t using public.profiles p
        where p.id = t.user_id and p.organization_id = s.organization_id
          and t.updated_at < now() - make_interval(days => s.search_days);
      get diagnostics n = row_count; searches := searches + n;
    end if;
    if s.reflection_days is not null then
      delete from public.reflection_logs r using public.profiles p
        where p.id = r.user_id and p.organization_id = s.organization_id
          and r.created_at < now() - make_interval(days => s.reflection_days);
      get diagnostics n = row_count; reflections := reflections + n;
    end if;
    if s.audit_log_days is not null then
      delete from public.audit_logs a using public.profiles p
        where p.id = a.actor_id and p.organization_id = s.organization_id
          and a.created_at < now() - make_interval(days => s.audit_log_days);
      get diagnostics n = row_count; audit := audit + n;
    end if;
    if s.profile_draft_days is not null then
      delete from public.profile_drafts d using public.profiles p
        where p.id = d.user_id and p.organization_id = s.organization_id
          and d.created_at < now() - make_interval(days => s.profile_draft_days);
      get diagnostics n = row_count; drafts := drafts + n;
    end if;
    if s.notification_days is not null then
      delete from public.notification_outbox o using public.profiles p
        where p.id = o.user_id and p.organization_id = s.organization_id
          and o.status in ('sent', 'failed')
          and o.created_at < now() - make_interval(days => s.notification_days);
      get diagnostics n = row_count; notifications := notifications + n;
    end if;
    if s.ai_telemetry_days is not null then
      delete from public.ai_runs a where a.organization_id = s.organization_id
        and a.created_at < now() - make_interval(days => s.ai_telemetry_days);
      get diagnostics n = row_count; ai_runs := ai_runs + n;
    end if;
    if s.outreach_days is not null then
      delete from public.outreach_targets o where o.organization_id = s.organization_id
        and o.created_at < now() - make_interval(days => s.outreach_days);
      get diagnostics n = row_count; outreach := outreach + n;
    end if;
    if s.invitation_days is not null then
      delete from public.invitations i where i.organization_id = s.organization_id
        and (i.status <> 'pending' or i.expires_at < now())
        and i.created_at < now() - make_interval(days => s.invitation_days);
      get diagnostics n = row_count; invitations := invitations + n;
    end if;
    if s.meeting_benefit_days is not null then
      delete from public.meeting_benefits b using public.profiles p
        where p.id = b.user_id and p.organization_id = s.organization_id
          and b.created_at < now() - make_interval(days => s.meeting_benefit_days);
      get diagnostics n = row_count; benefits := benefits + n;
    end if;
  end loop;
  return jsonb_build_object('messages', messages, 'sessions_cleared', sessions_cleared,
    'searches', searches, 'reflections', reflections, 'audit_logs', audit,
    'profile_drafts', drafts, 'notifications', notifications, 'ai_runs', ai_runs,
    'outreach_targets', outreach, 'invitations', invitations, 'meeting_benefits', benefits,
    'erased_user_ids', '[]'::jsonb);
end $$;

revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;

notify pgrst, 'reload schema';
