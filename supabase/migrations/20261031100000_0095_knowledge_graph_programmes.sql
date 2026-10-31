-- The knowledge graph groups people by programme (MiM, MSc in Finance, ...),
-- the programme already on each profile, instead of by field of study, so the
-- admin sees how programmes relate. It also links skills to each other.
--
-- Nodes: programmes (five or more members; smaller ones and members without a
-- programme are pooled, label null) and skills. Edges:
--   can_teach / wants_to_learn  programme -> skill, five or more members
--   skill_link                  skill -> skill, five or more people offer both
--   session / connection        programme -> programme, five or more participants
-- Spellings of one skill count together (normalize_skill): case, punctuation,
-- "modeling"/"modelling" and simple plurals. Nothing is named or grouped by
-- MENT beyond that; reading the network is left to the school.

create or replace function public.normalize_skill(p_skill text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    lower(coalesce(p_skill, '')),
    '[^[:alnum:]+#&]+', ' ', 'g'),          -- punctuation becomes a space (keeps c++, c#, m&a)
    '\mmodeling\M', 'modelling', 'g'),     -- one spelling of modelling
    '(\w{3,}[^siu\s])s\M', '\1', 'g'),   -- simple plurals: skills -> skill, not analysis
    '\s+', ' ', 'g')), '')
$$;

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
  v_org_filter := case when v_scope = 'platform' then p_org else v_caller_org end;
  if v_lang in ('all', 'any', '*') then v_lang := null; end if;

  with scoped as (
    select p.id, p.organization_id, nullif(trim(coalesce(p.program, '')), '') as raw_program
    from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_org_filter is null or p.organization_id = v_org_filter)
      and (v_lang is null or p.working_language = v_lang)
  ),
  program_sizes as (
    select raw_program, count(*)::int as member_count from scoped group by raw_program
  ),
  -- A programme under five members, or none given, joins the pooled group (null).
  members as (
    select s.id, case when ps.member_count >= 5 then s.raw_program end as program
    from scoped s join program_sizes ps on ps.raw_program is not distinct from s.raw_program
  ),
  programs as (
    select program, count(*)::int as member_count from members group by program having count(*) >= 5
  ),
  held as (
    select distinct m.id as member_id, m.program, public.normalize_skill(sk.skill) as skill_key,
      regexp_replace(trim(sk.skill), '[.,;:!?]+$', '') as label, sk.type
    from public.skills sk join members m on m.id = sk.user_id
    where sk.type in ('can_teach', 'wants_to_learn') and public.normalize_skill(sk.skill) is not null
  ),
  -- The most common spelling names the skill.
  labels as (
    select skill_key, (array_agg(label order by uses desc, label))[1] as label
    from (select skill_key, label, count(*) as uses from held group by skill_key, label) spelled
    group by skill_key
  ),
  skill_totals as (
    select skill_key,
      count(distinct member_id) filter (where type = 'can_teach')::int as teachers,
      count(distinct member_id) filter (where type = 'wants_to_learn')::int as learners
    from held group by skill_key
  ),
  skills_shown as (
    select t.skill_key, l.label, t.teachers, t.learners
    from skill_totals t join labels l using (skill_key)
    where t.teachers >= 5 or t.learners >= 5
  ),
  program_skill as (
    select h.program, h.skill_key, h.type, count(distinct h.member_id)::int as member_count
    from held h
    join programs p on p.program is not distinct from h.program
    join skills_shown s on s.skill_key = h.skill_key
    group by h.program, h.skill_key, h.type
    having count(distinct h.member_id) >= 5
  ),
  -- Two skills are linked when at least five people offer both.
  offered as (select distinct member_id, skill_key from held where type = 'can_teach'),
  skill_pairs as (
    select a.skill_key as skill_a, b.skill_key as skill_b, count(distinct a.member_id)::int as member_count
    from offered a join offered b on b.member_id = a.member_id and a.skill_key < b.skill_key
    group by a.skill_key, b.skill_key
    having count(distinct a.member_id) >= 5
  ),
  graph_nodes as (
    select jsonb_build_object('id', 'g:' || md5(coalesce(program, '(other)')), 'kind', 'program',
      'label', program, 'count', member_count) as node from programs
    union all
    select jsonb_build_object('id', 's:' || skill_key, 'kind', 'skill', 'label', label,
      'teachers', case when teachers >= 5 then teachers end,
      'learners', case when learners >= 5 then learners end) as node from skills_shown
  ),
  graph_edges as (
    select jsonb_build_object('source', 'g:' || md5(coalesce(ps.program, '(other)')), 'target', 's:' || ps.skill_key,
      'type', ps.type, 'count', ps.member_count) as edge
    from program_skill ps
    union all
    select jsonb_build_object('source', 's:' || skill_a, 'target', 's:' || skill_b, 'type', 'skill_link', 'count', member_count)
    from skill_pairs
    union all
    select jsonb_build_object('source', 'g:' || md5(coalesce(activity.program_a, '(other)')), 'target', 'g:' || md5(coalesce(activity.program_b, '(other)')),
      'type', event_type, 'count', participant_count) as edge
    from (
      select event_type, program_a, program_b, count(distinct participant_id)::int as participant_count
      from (
        select 'session'::text as event_type, least(coalesce(ma.program, '(other)'), coalesce(mb.program, '(other)')) as key_a,
          greatest(coalesce(ma.program, '(other)'), coalesce(mb.program, '(other)')) as key_b,
          case when coalesce(ma.program, '(other)') <= coalesce(mb.program, '(other)') then ma.program else mb.program end as program_a,
          case when coalesce(ma.program, '(other)') <= coalesce(mb.program, '(other)') then mb.program else ma.program end as program_b,
          participant_id
        from public.sessions s
        join members ma on ma.id = s.mentor_id
        join members mb on mb.id = s.mentee_id
        cross join lateral (values (s.mentor_id), (s.mentee_id)) as who(participant_id)
        where s.status = 'completed' and s.mentor_id <> s.mentee_id
        union all
        select 'connection', least(coalesce(ma.program, '(other)'), coalesce(mb.program, '(other)')),
          greatest(coalesce(ma.program, '(other)'), coalesce(mb.program, '(other)')),
          case when coalesce(ma.program, '(other)') <= coalesce(mb.program, '(other)') then ma.program else mb.program end,
          case when coalesce(ma.program, '(other)') <= coalesce(mb.program, '(other)') then mb.program else ma.program end,
          participant_id
        from public.connections c
        join members ma on ma.id = c.requester_id
        join members mb on mb.id = c.addressee_id
        cross join lateral (values (c.requester_id), (c.addressee_id)) as who(participant_id)
        where c.status = 'accepted' and c.requester_id <> c.addressee_id
      ) participants
      group by event_type, key_a, key_b, program_a, program_b
      having count(distinct participant_id) >= 5
    ) activity
    join programs a on a.program is not distinct from activity.program_a
    join programs b on b.program is not distinct from activity.program_b
  )
  select (select coalesce(jsonb_agg(node), '[]'::jsonb) from graph_nodes),
    (select coalesce(jsonb_agg(edge), '[]'::jsonb) from graph_edges)
  into v_nodes, v_edges;

  if v_scope = 'platform' then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type) order by o.name), '[]'::jsonb)
      into v_orgs from public.organizations o;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type)), '[]'::jsonb)
      into v_orgs from public.organizations o where o.id = v_caller_org;
  end if;

  select coalesce(jsonb_agg(language order by language), '[]'::jsonb) into v_langs
  from (
    select working_language as language from public.profiles
    where admin_scope = 'none' and deactivated_at is null
      and (v_scope = 'platform' or organization_id = v_caller_org)
    group by working_language having count(*) >= 5
  ) available_languages;

  return jsonb_build_object('nodes', v_nodes, 'edges', v_edges,
    'meta', jsonb_build_object('scope', v_scope, 'callerOrg', v_caller_org,
      'orgFilter', v_org_filter, 'language', v_lang, 'organizations', v_orgs, 'languages', v_langs));
end;
$$;


revoke all on function public.knowledge_graph(uuid, text) from public;
grant execute on function public.knowledge_graph(uuid, text) to authenticated;

notify pgrst, 'reload schema';
