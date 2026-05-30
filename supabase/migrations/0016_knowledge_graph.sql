-- Company knowledge graph (admin-only).
--
-- Adds a `working_language` attribute to profiles (so the graph can be filtered
-- by the language a person actually works in) and a security-definer RPC that
-- returns the organization's skills/people graph as { nodes, edges, meta }.
--
-- Authorization mirrors the existing admin helpers (0001/0006/0013):
--   * only org/platform admins may call it;
--   * org admins are pinned to their own org regardless of p_org;
--   * platform admins may pass any org id or null (= every org);
--   * inter-company orgs get the same redaction as peer_profile (0013):
--     names collapse to "First L." and job_title/location are blanked.

-- ---------------------------------------------------------------------
-- 1. working_language column + realistic backfill (no dummy rows: we set a
--    real attribute on the real demo population).
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists working_language text not null default 'en';

-- Deterministic spread skewed to English with Italian/French/German
-- minorities. Ordered by (created_at, id) so re-running the migration is
-- idempotent and never produces a different assignment.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.profiles
)
update public.profiles p
set working_language = case (o.rn - 1) % 5
  when 0 then 'en'
  when 1 then 'en'
  when 2 then 'it'
  when 3 then 'fr'
  else 'de'
end
from ordered o
where o.id = p.id;

create index if not exists profiles_working_language_idx
  on public.profiles(organization_id, working_language);

-- ---------------------------------------------------------------------
-- 2. knowledge_graph RPC
-- ---------------------------------------------------------------------

create or replace function public.knowledge_graph(
  p_org uuid default null,
  p_language text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_scope text;
  v_caller_org uuid;
  v_org_filter uuid;
  v_lang text := nullif(trim(coalesce(p_language, '')), '');
  v_nodes jsonb;
  v_edges jsonb;
  v_orgs jsonb;
  v_langs jsonb;
begin
  if v_caller is null then raise exception 'auth_required'; end if;

  v_scope := public.admin_scope_for(v_caller);
  if v_scope not in ('org', 'platform') then raise exception 'admin_only'; end if;

  select organization_id into v_caller_org from public.profiles where id = v_caller;

  -- Org scoping. Org admins are pinned to their own org regardless of the
  -- requested p_org; platform admins may target any org or null (all orgs).
  if v_scope = 'platform' then
    v_org_filter := p_org;
  else
    v_org_filter := v_caller_org;
  end if;

  -- 'all'/'any'/'*' are treated as "no language filter".
  if v_lang in ('all', 'any', '*') then v_lang := null; end if;

  with people as (
    select p.id, p.name, p.department, p.seniority, p.job_title, p.location,
           p.working_language, p.organization_id,
           coalesce(o.type, 'intra') as org_type
    from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.admin_scope = 'none'
      and p.deactivated_at is null
      and (v_org_filter is null or p.organization_id = v_org_filter)
      and (v_lang is null or p.working_language = v_lang)
  ),
  person_nodes as (
    select jsonb_build_object(
      'id', 'p:' || pe.id::text,
      'kind', 'person',
      'label', case when pe.org_type = 'inter'
                    then public.redacted_name(pe.name) else pe.name end,
      'department', pe.department,
      'seniority', pe.seniority,
      -- Inter-company mode hides identifying fields (see peer_profile 0013).
      'job_title', case when pe.org_type = 'inter' then null else pe.job_title end,
      'location', case when pe.org_type = 'inter' then null else pe.location end,
      'working_language', pe.working_language,
      'org_id', pe.organization_id,
      'org_type', pe.org_type,
      'redacted', pe.org_type = 'inter'
    ) as node
    from people pe
  ),
  rels as (
    select s.user_id,
           lower(trim(s.skill)) as skill_key,
           s.skill as skill_label,
           s.type
    from public.skills s
    join people pe on pe.id = s.user_id
    where coalesce(trim(s.skill), '') <> ''
  ),
  skill_nodes as (
    select jsonb_build_object(
      'id', 's:' || r.skill_key,
      'kind', 'skill',
      'label', min(r.skill_label),
      'teachers', count(*) filter (where r.type = 'can_teach'),
      'learners', count(*) filter (where r.type = 'wants_to_learn'),
      'degree', count(*)
    ) as node
    from rels r
    group by r.skill_key
  ),
  edges as (
    select jsonb_build_object(
      'source', 'p:' || r.user_id::text,
      'target', 's:' || r.skill_key,
      'type', r.type
    ) as edge
    from rels r
  )
  select
    (select coalesce(jsonb_agg(node), '[]'::jsonb)
       from (select node from person_nodes
             union all
             select node from skill_nodes) n),
    (select coalesce(jsonb_agg(edge), '[]'::jsonb) from edges)
  into v_nodes, v_edges;

  -- Orgs the caller may scope the graph to (drives the company filter).
  if v_scope = 'platform' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'type', o.type) order by o.name), '[]'::jsonb)
    into v_orgs from public.organizations o;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'type', o.type)), '[]'::jsonb)
    into v_orgs from public.organizations o where o.id = v_caller_org;
  end if;

  -- Distinct working languages available in scope (drives the language filter).
  select coalesce(jsonb_agg(distinct working_language order by working_language), '[]'::jsonb)
  into v_langs
  from public.profiles
  where admin_scope = 'none'
    and deactivated_at is null
    and (v_scope = 'platform' or organization_id = v_caller_org);

  return jsonb_build_object(
    'nodes', v_nodes,
    'edges', v_edges,
    'meta', jsonb_build_object(
      'scope', v_scope,
      'callerOrg', v_caller_org,
      'orgFilter', v_org_filter,
      'language', v_lang,
      'organizations', v_orgs,
      'languages', v_langs
    )
  );
end;
$$;

revoke all on function public.knowledge_graph(uuid, text) from public;
grant execute on function public.knowledge_graph(uuid, text) to authenticated;
