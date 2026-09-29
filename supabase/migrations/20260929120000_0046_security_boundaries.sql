-- Close scan-confirmed RPC, tenant, signup, privacy, and deactivation gaps.

create or replace function public.is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select p_user_id = auth.uid() and coalesce((
    select admin_scope in ('org', 'platform') or is_admin
    from public.profiles
    where id = p_user_id and deactivated_at is null
  ), false);
$$;
revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id = auth.uid() and deactivated_at is null
  );
$$;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

-- SQL-language SECURITY DEFINER RPCs are not covered by the PL/pgSQL guard
-- below, so explicitly preserve deactivation checks for these caller RPCs.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.my_invitations()'::regprocedure);
  v_old := 'where caller.admin_scope in (''org'', ''platform'')';
  v_new := v_old || ' and caller.deactivated_at is null';
  if position(v_old in v_def) = 0 then
    raise exception 'my_invitations expected authorization clause not found';
  end if;
  execute replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('public.my_monthly_completed_count()'::regprocedure);
  v_old := 'where (s.mentor_id = auth.uid() or s.mentee_id = auth.uid())';
  v_new := v_old || ' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.deactivated_at is null)';
  if position(v_old in v_def) = 0 then
    raise exception 'my_monthly_completed_count expected caller filter not found';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

-- Restrictive policies compose with existing table policies and immediately
-- cut off deactivated accounts without affecting service-role workers.
do $$
declare t record;
begin
  for t in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists active_account_required on %I.%I', t.nspname, t.relname);
    execute format(
      'create policy active_account_required on %I.%I as restrictive for all to authenticated using (public.is_active_user()) with check (public.is_active_user())',
      t.nspname, t.relname
    );
  end loop;
end;
$$;

-- SECURITY DEFINER RPCs bypass RLS. Add the same active-account invariant to
-- authenticated PL/pgSQL RPCs that use the caller JWT. Service workers without
-- an end-user JWT retain their existing behavior.
do $$
declare
  f record;
  v_guarded text;
  v_count integer := 0;
begin
  for f in
    select p.oid, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prosecdef
      and l.lanname = 'plpgsql'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.prosrc ilike '%auth.uid()%'
      and p.prosrc not ilike '%public.is_active_user()%'
  loop
    v_guarded := regexp_replace(
      f.definition,
      E'(?im)^[ \\t]*BEGIN[ \\t]*$',
      'BEGIN' || chr(10) || '  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN RAISE EXCEPTION ''account_deactivated''; END IF;',
      'im'
    );
    if v_guarded <> f.definition then
      execute v_guarded;
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then raise exception 'no authenticated SECURITY DEFINER RPCs received active-account guards'; end if;
end;
$$;

-- Preserve the report aggregation and add tenant scope without duplicating it.
do $$
declare
  v_def text;
  v_old text := '  if p_manager_id <> v_caller and not public.is_admin(v_caller) then';
  v_new text := '  if p_manager_id <> v_caller and (not public.is_admin(v_caller) or (not public.is_platform_admin(v_caller) and public.current_organization_id(p_manager_id) is distinct from public.current_organization_id(v_caller))) then';
begin
  if to_regprocedure('public.team_skill_gaps(uuid)') is not null then
    v_def := pg_get_functiondef('public.team_skill_gaps(uuid)'::regprocedure);
    if position(v_old in v_def) = 0 then
      raise exception 'team_skill_gaps expected authorization guard not found';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$$;

create or replace function public.mark_matches_stale(p_user_id uuid default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_caller_org uuid;
  v_target_org uuid;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if v_target is null then raise exception 'invalid_target'; end if;
  if v_target <> v_caller then
    if not public.is_admin(v_caller) then raise exception 'forbidden'; end if;
    select organization_id into v_caller_org from public.profiles where id = v_caller;
    select organization_id into v_target_org from public.profiles where id = v_target;
    if v_caller_org is distinct from v_target_org and not public.is_platform_admin(v_caller) then
      raise exception 'forbidden';
    end if;
  end if;
  update public.profiles set matches_stale = true
  where id = v_target and admin_scope = 'none' and deactivated_at is null;
end;
$$;
revoke all on function public.mark_matches_stale(uuid) from public, anon;
grant execute on function public.mark_matches_stale(uuid) to authenticated;

-- Affinity is an internal matching primitive; only SECURITY DEFINER matching
-- functions may invoke it, never a client-supplied pair of profile IDs.
revoke all on function public.pair_affinity(uuid, uuid) from public, anon, authenticated;

-- Bound every field at the database boundary; writes go through the
-- IP-rate-limited request-access Edge Function.
alter table public.access_requests
  add constraint access_requests_name_length check (char_length(trim(name)) between 1 and 120) not valid,
  add constraint access_requests_email_length check (char_length(email) between 3 and 254) not valid,
  add constraint access_requests_company_length check (char_length(trim(company)) between 1 and 160) not valid,
  add constraint access_requests_company_size_length check (char_length(trim(company_size)) between 1 and 80) not valid,
  add constraint access_requests_role_length check (char_length(trim(role)) between 1 and 120) not valid,
  add constraint access_requests_source_length check (char_length(source) between 1 and 80) not valid;
revoke insert on public.access_requests from anon, authenticated;
revoke usage, select on sequence public.access_requests_id_seq from anon, authenticated;

-- Users may make their own mentoring availability more restrictive or
-- generous within the published bounds. This is an intentional product control.
-- Organization admins may tighten privacy, but only platform admins can loosen it.
create or replace function public.set_org_privacy(p_type text default null, p_min_team_dashboard_size integer default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_scope text;
  v_org uuid;
  v_current_type text;
  v_row public.organizations;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  v_scope := public.admin_scope_for(v_caller);
  select organization_id into v_org from public.profiles where id = v_caller and deactivated_at is null;
  if v_org is null then raise exception 'no_org'; end if;
  select type into v_current_type from public.organizations where id = v_org;
  if p_type is not null then
    if v_scope not in ('org', 'platform') then raise exception 'forbidden'; end if;
    if p_type not in ('intra', 'inter') then raise exception 'invalid_type'; end if;
    if v_scope <> 'platform' and v_current_type = 'inter' and p_type = 'intra' then
      raise exception 'platform_admin_required_to_loosen_privacy';
    end if;
    update public.organizations set type = p_type where id = v_org;
  end if;
  if p_min_team_dashboard_size is not null then
    if v_scope not in ('org', 'platform') then raise exception 'forbidden'; end if;
    if p_min_team_dashboard_size not between 1 and 100 then raise exception 'invalid_min_size'; end if;
    update public.organizations set min_team_dashboard_size = p_min_team_dashboard_size where id = v_org;
  end if;
  select * into v_row from public.organizations where id = v_org;
  return jsonb_build_object('id',v_row.id,'name',v_row.name,'slug',v_row.slug,'type',v_row.type,
    'min_team_dashboard_size',v_row.min_team_dashboard_size);
end;
$$;
revoke all on function public.set_org_privacy(text, integer) from public, anon;
grant execute on function public.set_org_privacy(text, integer) to authenticated;

-- Public Auth signup no longer attaches accounts to the demo tenant or trusts
-- user-controlled onboarding/password flags.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := nullif(new.raw_app_meta_data->>'organization_id', '')::uuid;
  v_scope text := coalesce(new.raw_app_meta_data->>'admin_scope', 'none');
begin
  if v_org is null or not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'trusted_organization_required';
  end if;
  if v_scope not in ('none', 'org', 'platform') then raise exception 'invalid_admin_scope'; end if;
  insert into public.profiles (
    id, name, department, seniority, job_title, tenure_years, location,
    must_change_password, is_admin, admin_scope, organization_id, onboarding_complete
  ) values (
    new.id, coalesce(new.raw_user_meta_data->>'name',''),
    coalesce(new.raw_user_meta_data->>'department',''),
    case when new.raw_user_meta_data->>'seniority' in ('junior','mid','senior','lead')
      then new.raw_user_meta_data->>'seniority' else 'junior' end,
    coalesce(new.raw_user_meta_data->>'job_title',''), 0,
    coalesce(new.raw_user_meta_data->>'location',''),
    coalesce((new.raw_app_meta_data->>'must_change_password')::boolean, false),
    v_scope in ('org', 'platform'), v_scope, v_org, false
  ) on conflict (id) do nothing;
  return new;
end;
$$;

-- Correct the onboarding filter on both stored and directory match paths.
do $$
declare
  v_def text;
  v_old text := 'if v_other.id is null or v_other.deactivated_at is not null then continue; end if;';
  v_new text := 'if v_other.id is null or v_other.deactivated_at is not null or not v_other.onboarding_complete then continue; end if;';
begin
  v_def := pg_get_functiondef('public.get_matches_for(text,integer,integer,boolean)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'get_matches_for expected eligibility guard not found'; end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

-- The client must use the Edge Function, which verifies and updates the Auth
-- password before clearing this flag.
revoke all on function public.complete_password_change() from public, anon, authenticated;
