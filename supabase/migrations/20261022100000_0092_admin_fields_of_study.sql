-- Admin overview for a university: fields of study and the skills they take
-- part in, without counts that could point at a person.
--
-- MENT now serves universities, so the admin calls a profile's department its
-- field of study. Fields under five members are pooled (field = null, shown as
-- "Other fields of study"), as in 0090. Per field the admin sees its size,
-- which is always five or more, and only whether it has had any sessions.
-- Per skill they see which fields offer it, want it and have met on it, as
-- lists without counts, so no small number is ever shown.

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
    select p.id, nullif(trim(p.department), '') raw_field
    from public.profiles p
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_platform or p.organization_id = v_org)
  ), sized as (
    select s.id, case when count(*) over (partition by s.raw_field) >= 5 then s.raw_field end as field
    from scoped s
  ), field_rows as (
    select m.field, count(*)::int members,
      bool_or(exists (select 1 from public.sessions x where m.id in (x.mentor_id, x.mentee_id)
        and x.status in ('scheduled', 'completed'))) active
    from sized m group by m.field
    -- A pool smaller than five is left out rather than shown.
    having count(*) >= 5
  ), shown as (
    -- Members of a group that is shown; nobody else counts towards a skill.
    select m.id, m.field from sized m where exists (select 1 from field_rows f where f.field is not distinct from m.field)
  ), declared as (
    select lower(trim(k.skill)) skill_key, k.skill label, k.type, m.field
    from public.skills k join shown m on m.id = k.user_id
    where coalesce(trim(k.skill), '') <> ''
  ), met as (
    select lower(trim(topic)) skill_key, topic label, m.field
    from public.sessions x
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x.topics) = 'array' then x.topics else '[]'::jsonb end) topic
    join shown m on m.id in (x.mentor_id, x.mentee_id)
    where x.status in ('scheduled', 'completed') and coalesce(trim(topic), '') <> ''
  ), ranked as (
    -- Order by how much a skill is offered, wanted and met on; the order is
    -- shown, the numbers are not.
    select skill_key, min(label) label, count(*) weight
    from (select skill_key, label from declared union all select skill_key, label from met) all_rows
    group by skill_key order by count(*) desc, skill_key limit v_limit
  ), fields_of as (
    select r.skill_key, r.label, r.weight,
      (select coalesce(jsonb_agg(distinct d.field), '[]'::jsonb) from declared d where d.skill_key = r.skill_key and d.type = 'can_teach') offered,
      (select coalesce(jsonb_agg(distinct d.field), '[]'::jsonb) from declared d where d.skill_key = r.skill_key and d.type = 'wants_to_learn') wanted,
      (select coalesce(jsonb_agg(distinct x.field), '[]'::jsonb) from met x where x.skill_key = r.skill_key) sessions
    from ranked r
  )
  select jsonb_build_object(
    'fields', coalesce((select jsonb_agg(jsonb_build_object('field', field, 'members', members, 'active', active)
      order by field is null, members desc, field) from field_rows), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', label, 'offered', offered, 'wanted', wanted, 'sessions', sessions)
      order by weight desc, skill_key) from fields_of), '[]'::jsonb)
  ));
end $$;
revoke all on function public.admin_fields_of_study(integer) from public, anon;
grant execute on function public.admin_fields_of_study(integer) to authenticated;

notify pgrst, 'reload schema';
