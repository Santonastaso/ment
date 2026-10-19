-- Data retention (GDPR Art. 5(1)(e)). Each organisation sets how long MENT
-- keeps each kind of data; until it does, every period is empty and nothing is
-- deleted. The controller (ESSEC) decides the periods; MENT only applies them.
--
--   conversation_days        messages in requests and groups, and the free text
--                            of closed requests, counted from the last activity
--   search_days              saved searches with the assistant
--   reflection_days          private reflections
--   audit_log_days           audit entries caused by members of the organisation
--   deactivated_account_days a deactivated account is erased this long after
--                            deactivation, as erase_account_data does
--
-- run_data_retention applies every organisation's periods. It returns the
-- accounts it erased so the retention-sweep Edge Function can also close their
-- logins, which only the auth API can do.

create table public.retention_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  conversation_days integer check (conversation_days between 30 and 3650),
  search_days integer check (search_days between 30 and 3650),
  reflection_days integer check (reflection_days between 30 and 3650),
  audit_log_days integer check (audit_log_days between 30 and 3650),
  deactivated_account_days integer check (deactivated_account_days between 30 and 3650),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.retention_settings enable row level security;
revoke all on public.retention_settings from public, anon, authenticated;

create or replace function public.admin_retention_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.current_organization_id(auth.uid()); row public.retention_settings;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin_only'; end if;
  select * into row from public.retention_settings where organization_id = v_org;
  return jsonb_build_object(
    'conversation_days', row.conversation_days, 'search_days', row.search_days,
    'reflection_days', row.reflection_days, 'audit_log_days', row.audit_log_days,
    'deactivated_account_days', row.deactivated_account_days, 'updated_at', row.updated_at);
end $$;
revoke all on function public.admin_retention_settings() from public, anon;
grant execute on function public.admin_retention_settings() to authenticated;

create or replace function public.admin_set_retention_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_organization_id(auth.uid());
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin_only'; end if;
  if v_org is null then raise exception 'organization_required'; end if;
  -- Empty means keep; anything else must be a whole number of days in range,
  -- which the table's checks enforce.
  insert into public.retention_settings (organization_id, conversation_days, search_days, reflection_days,
    audit_log_days, deactivated_account_days, updated_at, updated_by)
  values (v_org,
    nullif(p_settings->>'conversation_days', '')::integer, nullif(p_settings->>'search_days', '')::integer,
    nullif(p_settings->>'reflection_days', '')::integer, nullif(p_settings->>'audit_log_days', '')::integer,
    nullif(p_settings->>'deactivated_account_days', '')::integer, now(), auth.uid())
  on conflict (organization_id) do update set
    conversation_days = excluded.conversation_days, search_days = excluded.search_days,
    reflection_days = excluded.reflection_days, audit_log_days = excluded.audit_log_days,
    deactivated_account_days = excluded.deactivated_account_days, updated_at = now(), updated_by = auth.uid();
  return public.admin_retention_settings();
end $$;
revoke all on function public.admin_set_retention_settings(jsonb) from public, anon;
grant execute on function public.admin_set_retention_settings(jsonb) to authenticated;

create or replace function public.run_data_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.retention_settings; n integer;
  messages integer := 0; sessions_cleared integer := 0; searches integer := 0;
  reflections integer := 0; audit integer := 0; erased uuid[] := '{}'; member uuid;
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
    if s.deactivated_account_days is not null then
      for member in select id from public.profiles
        where organization_id = s.organization_id and admin_scope = 'none' and not is_admin
          and erased_at is null and deactivated_at < now() - make_interval(days => s.deactivated_account_days)
      loop
        perform public.erase_account_data(member);
        erased := erased || member;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('messages', messages, 'sessions_cleared', sessions_cleared, 'searches', searches,
    'reflections', reflections, 'audit_logs', audit, 'erased_user_ids', to_jsonb(erased));
end $$;
revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;

notify pgrst, 'reload schema';
