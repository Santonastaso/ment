-- Platform operators can provision a new school administrator. The Auth user
-- is created by the Edge Function; this transaction grants the profile role
-- and records the grant together, so an unaudited admin is never left behind.
create or replace function public.platform_provision_org_admin(
  p_actor_id uuid,
  p_user_id uuid,
  p_organization_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and admin_scope = 'platform' and deactivated_at is null
  ) then
    raise exception 'platform_admin_required';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization_missing';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'auth_user_missing';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile_already_exists';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'name_required';
  end if;

  insert into public.profiles (
    id, name, organization_id, admin_scope, is_admin, role,
    onboarding_complete, must_change_password
  ) values (
    p_user_id, trim(p_name), p_organization_id, 'org', true, 'student',
    true, true
  );

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor_id, 'admin.org_admin_provisioned', 'profile', p_user_id::text,
    jsonb_build_object('organization_id', p_organization_id)
  );
end;
$$;

revoke all on function public.platform_provision_org_admin(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.platform_provision_org_admin(uuid, uuid, uuid, text) to service_role;
