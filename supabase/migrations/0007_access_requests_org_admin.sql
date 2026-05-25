-- 80/20 product readiness: request-access leads, platform org creation, and privacy status.

create table if not exists public.access_requests (
  id bigserial primary key,
  name text not null check (char_length(trim(name)) > 0),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company text not null check (char_length(trim(company)) > 0),
  company_size text not null check (char_length(trim(company_size)) > 0),
  role text not null check (char_length(trim(role)) > 0),
  note text not null default '' check (char_length(note) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  source text not null default 'request-access',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  contacted_at timestamptz,
  closed_at timestamptz
);

create unique index if not exists access_requests_open_email_idx
  on public.access_requests (lower(email))
  where status in ('new', 'contacted');

alter table public.access_requests enable row level security;

drop policy if exists access_requests_insert_public on public.access_requests;
create policy access_requests_insert_public on public.access_requests
  for insert to anon, authenticated
  with check (status = 'new');

drop policy if exists access_requests_select_platform on public.access_requests;
create policy access_requests_select_platform on public.access_requests
  for select to authenticated
  using (public.is_platform_admin(auth.uid()));

drop policy if exists access_requests_update_platform on public.access_requests;
create policy access_requests_update_platform on public.access_requests
  for update to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

drop policy if exists orgs_insert_platform on public.organizations;
create policy orgs_insert_platform on public.organizations
  for insert to authenticated
  with check (public.is_platform_admin(auth.uid()));

revoke all on public.access_requests from anon, authenticated;
grant insert on public.access_requests to anon, authenticated;
grant select, update on public.access_requests to authenticated;
grant usage, select on sequence public.access_requests_id_seq to anon, authenticated;
grant select, insert on public.organizations to authenticated;

create or replace function public.platform_create_organization(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_base_slug text;
  v_slug text;
  v_suffix int := 1;
  v_org public.organizations;
begin
  if not public.is_platform_admin(v_caller) then raise exception 'platform_admin_only'; end if;
  if char_length(v_name) < 2 then raise exception 'organization_name_required'; end if;

  v_base_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'organization';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  insert into public.organizations (name, slug)
  values (v_name, v_slug)
  returning * into v_org;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    v_caller,
    'platform.organization_create',
    'organization',
    v_org.id::text,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug)
  );

  return jsonb_build_object(
    'organizationId', v_org.id,
    'organizationName', v_org.name,
    'slug', v_org.slug,
    'totalUsers', 0,
    'onboarded', 0,
    'onboardingRate', 0,
    'activeMembers', 0,
    'sessions', 0,
    'churned', 0
  );
end;
$$;

create or replace function public.platform_access_requests(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 250);
begin
  if not public.is_platform_admin(v_caller) then raise exception 'platform_admin_only'; end if;

  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ar.id,
        'name', ar.name,
        'email', ar.email,
        'company', ar.company,
        'companySize', ar.company_size,
        'role', ar.role,
        'note', ar.note,
        'status', ar.status,
        'createdAt', ar.created_at,
        'updatedAt', ar.updated_at,
        'contactedAt', ar.contacted_at,
        'closedAt', ar.closed_at
      ) order by ar.created_at desc)
      from (
        select *
        from public.access_requests
        order by created_at desc
        limit v_limit
      ) ar
    ), '[]'::jsonb),
    'total', (select count(*) from public.access_requests)
  );
end;
$$;

create or replace function public.platform_update_access_request(p_id bigint, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.access_requests;
begin
  if not public.is_platform_admin(v_caller) then raise exception 'platform_admin_only'; end if;
  if v_status not in ('new', 'contacted', 'closed') then raise exception 'invalid_status'; end if;

  update public.access_requests
  set
    status = v_status,
    updated_at = now(),
    contacted_at = case when v_status = 'contacted' and contacted_at is null then now() else contacted_at end,
    closed_at = case when v_status = 'closed' and closed_at is null then now() else closed_at end
  where id = p_id
  returning * into v_row;

  if v_row.id is null then raise exception 'not_found'; end if;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    v_caller,
    'platform.access_request_update',
    'access_request',
    v_row.id::text,
    jsonb_build_object('status', v_row.status)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'email', v_row.email,
    'company', v_row.company,
    'companySize', v_row.company_size,
    'role', v_row.role,
    'note', v_row.note,
    'status', v_row.status,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'contactedAt', v_row.contacted_at,
    'closedAt', v_row.closed_at
  );
end;
$$;

create or replace function public.privacy_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return jsonb_build_object(
    'aiClassification', jsonb_build_object(
      'label', 'Off by default',
      'enabled', false,
      'source', 'AI_CLASSIFICATION_ENABLED must be explicitly true in Supabase Edge Function settings'
    ),
    'supabaseRegion', 'eu-central-1',
    'peerVisibleFields', jsonb_build_array(
      'first name + last initial',
      'role',
      'department',
      'location',
      'bio',
      'teachable skills'
    ),
    'hiddenFields', jsonb_build_array(
      'reflections',
      'ratings',
      'wants-to-learn',
      'shadow role',
      'career company/details'
    ),
    'edgeFunctions', jsonb_build_array(
      jsonb_build_object('name', 'admin-create-user', 'status', 'configured'),
      jsonb_build_object('name', 'admin-reset-password', 'status', 'configured'),
      jsonb_build_object('name', 'profile-ingest', 'status', 'configured'),
      jsonb_build_object('name', 'reflection-classify', 'status', 'configured')
    )
  );
end;
$$;

revoke all on function
  public.platform_create_organization(text),
  public.platform_access_requests(int),
  public.platform_update_access_request(bigint, text),
  public.privacy_status()
from public;

grant execute on function
  public.platform_create_organization(text),
  public.platform_access_requests(int),
  public.platform_update_access_request(bigint, text),
  public.privacy_status()
to authenticated;
