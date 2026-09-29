-- Admin Auth creation cannot set trusted app_metadata until after the Auth row
-- exists. Keep unassigned Auth rows profile-less; server-side provisioning
-- attaches trusted metadata and inserts the profile immediately afterwards.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := nullif(new.raw_app_meta_data->>'organization_id', '')::uuid;
  v_scope text := coalesce(new.raw_app_meta_data->>'admin_scope', 'none');
begin
  if v_org is null then
    return new;
  end if;
  if not exists (select 1 from public.organizations where id = v_org) then
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
