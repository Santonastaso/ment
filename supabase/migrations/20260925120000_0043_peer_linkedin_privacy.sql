-- Recovered from production on 2026-09-26.
--
-- This migration was applied directly to the database on 2026-09-25 and never
-- committed, so supabase/migrations did not describe the live schema and both
-- db push and db pull refused to run. The SQL below is the exact text stored in
-- supabase_migrations.schema_migrations for version 20260925120000.
--
-- Nothing here is new to production: create or replace plus the grants are
-- idempotent, so applying it to a fresh database reproduces what is live.
--
-- What it does: LinkedIn URL and headline are returned only to a viewer who
-- has an accepted connection or a scheduled/completed session with that person,
-- and only inside an organization of type 'inter'. Everyone else gets nulls.

-- Keep LinkedIn identity details behind the inter-company connection boundary.
create or replace function public.peer_linkedin(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_org uuid;
  org_type text;
  target public.profiles;
begin
  if caller is null then raise exception 'auth_required'; end if;

  select organization_id into caller_org
  from public.profiles where id = caller and deactivated_at is null;
  if caller_org is null then raise exception 'not_found'; end if;

  select * into target
  from public.profiles
  where id = p_user_id and organization_id = caller_org and deactivated_at is null;
  if target.id is null then raise exception 'not_found'; end if;

  select coalesce(type, 'intra') into org_type
  from public.organizations where id = caller_org;

  if org_type = 'inter' and not (
    exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and ((c.requester_id = caller and c.addressee_id = target.id)
          or (c.requester_id = target.id and c.addressee_id = caller))
    )
    or exists (
      select 1 from public.sessions s
      where s.status in ('scheduled', 'completed')
        and ((s.mentor_id = caller and s.mentee_id = target.id)
          or (s.mentor_id = target.id and s.mentee_id = caller))
    )
  ) then
    return jsonb_build_object('linkedin_url', null, 'linkedin_headline', null);
  end if;

  return jsonb_build_object(
    'linkedin_url', target.linkedin_url,
    'linkedin_headline', target.linkedin_headline
  );
end;
$$;

revoke all on function public.peer_linkedin(uuid) from public, anon;

grant execute on function public.peer_linkedin(uuid) to authenticated;
