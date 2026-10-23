-- Replace the 0092 admin report on databases that have already applied it.
-- A field/skill relationship is reportable only after five distinct members
-- participate, and meeting claims use completed sessions only.

create or replace function public.admin_fields_of_study(p_skill_limit integer default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
  v_limit integer := least(greatest(coalesce(p_skill_limit, 12), 1), 30);
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return (with scoped as (
    select p.id, p.role, nullif(trim(p.department), '') raw_field
    from public.profiles p
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_platform or p.organization_id = v_org)
  ), sized as (
    select s.id, case when count(*) over (partition by s.raw_field) >= 5 then s.raw_field end as field
    from scoped s
  ), field_rows as (
    select m.field, count(*)::int members,
      count(distinct m.id) filter (where exists (
        select 1 from public.sessions x where m.id in (x.mentor_id, x.mentee_id)
          and x.status = 'completed')) >= 5 active
    from sized m group by m.field
    -- A pool smaller than five is left out rather than shown.
    having count(*) >= 5
  ), shown as (
    -- Members of a group that is shown; nobody else counts towards a skill.
    select m.id, m.field from sized m where exists (select 1 from field_rows f where f.field is not distinct from m.field)
  ), declared as (
    select lower(trim(k.skill)) skill_key, trim(k.skill) label, k.type, m.id member_id, m.field
    from public.skills k join shown m on m.id = k.user_id
    where coalesce(trim(k.skill), '') <> ''
  ), met as (
    select lower(trim(topic)) skill_key, trim(topic) label, m.id member_id, m.field
    from public.sessions x
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x.topics) = 'array' then x.topics else '[]'::jsonb end) topic
    join shown m on m.id in (x.mentor_id, x.mentee_id)
    where x.status = 'completed' and coalesce(trim(topic), '') <> ''
  ), participation as (
    select skill_key, label, member_id, field, type relationship from declared
    union all
    select skill_key, label, member_id, field, 'sessions' relationship from met
  ), reportable as (
    -- Duplicate skill rows or repeat meetings from one person cannot meet the threshold.
    select skill_key, field, relationship, min(label) label,
      count(distinct member_id) participants
    from participation
    where relationship in ('can_teach', 'wants_to_learn', 'sessions')
    group by skill_key, field, relationship
    having count(distinct member_id) >= 5
  ), ranked as (
    -- Only reportable cells can create a skill row or affect its ranking.
    select skill_key, min(label) label, sum(participants) weight
    from reportable
    group by skill_key order by sum(participants) desc, skill_key limit v_limit
  ), fields_of as (
    select r.skill_key, r.label, r.weight,
      (select coalesce(jsonb_agg(c.field order by c.field), '[]'::jsonb) from reportable c where c.skill_key = r.skill_key and c.relationship = 'can_teach') offered,
      (select coalesce(jsonb_agg(c.field order by c.field), '[]'::jsonb) from reportable c where c.skill_key = r.skill_key and c.relationship = 'wants_to_learn') wanted,
      (select coalesce(jsonb_agg(c.field order by c.field), '[]'::jsonb) from reportable c where c.skill_key = r.skill_key and c.relationship = 'sessions') sessions
    from ranked r
  )
  select jsonb_build_object(
    -- Students and alumni, each shown only from five up.
    'students', (select case when count(*) >= 5 then count(*)::int end from scoped where role = 'student'),
    'alumni', (select case when count(*) >= 5 then count(*)::int end from scoped where role = 'alumnus'),
    'fields', coalesce((select jsonb_agg(jsonb_build_object('field', field, 'members', members, 'active', active)
      order by field is null, members desc, field) from field_rows), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', label, 'offered', offered, 'wanted', wanted, 'sessions', sessions)
      order by weight desc, skill_key) from fields_of), '[]'::jsonb)
  ));
end $$;
revoke all on function public.admin_fields_of_study(integer) from public, anon;
grant execute on function public.admin_fields_of_study(integer) to authenticated;

notify pgrst, 'reload schema';
