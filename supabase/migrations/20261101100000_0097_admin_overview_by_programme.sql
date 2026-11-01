-- The admin Overview follows the knowledge graph (0096): people are grouped by
-- the programme on their profile (MiM, MSc in Finance, ...) instead of their
-- field of study, and spellings of one skill count together, named by the
-- most common spelling. Thresholds and output are as in 0093 and 0094; the
-- "fields" keys keep their names so pages already open keep working, and now
-- hold programmes.

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
    select p.id, p.role, nullif(trim(p.program), '') raw_field
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
    select public.normalize_skill(k.skill) skill_key, regexp_replace(trim(k.skill), '[.,;:!?]+$', '') label, k.type, m.id member_id, m.field
    from public.skills k join shown m on m.id = k.user_id
    where public.normalize_skill(k.skill) is not null
  ), met as (
    select public.normalize_skill(topic) skill_key, regexp_replace(trim(topic), '[.,;:!?]+$', '') label, m.id member_id, m.field
    from public.sessions x
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x.topics) = 'array' then x.topics else '[]'::jsonb end) topic
    join shown m on m.id in (x.mentor_id, x.mentee_id)
    where x.status = 'completed' and public.normalize_skill(topic) is not null
  ), participation as (
    select skill_key, label, member_id, field, type relationship from declared
    union all
    select skill_key, label, member_id, field, 'sessions' relationship from met
  ), reportable as (
    -- Duplicate skill rows or repeat meetings from one person cannot meet the threshold.
    select skill_key, field, relationship, mode() within group (order by label) label,
      count(distinct member_id) participants
    from participation
    where relationship in ('can_teach', 'wants_to_learn', 'sessions')
    group by skill_key, field, relationship
    having count(distinct member_id) >= 5
  ), ranked as (
    -- Only reportable cells can create a skill row or affect its ranking.
    select skill_key, mode() within group (order by label) label, sum(participants) weight
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

create or replace function public.admin_programme_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return (with members as (
    select p.id, p.role, p.onboarding_complete, p.created_at
    from public.profiles p
    where p.admin_scope = 'none' and p.deactivated_at is null
      and (v_platform or p.organization_id = v_org)
  ), alumni_available as (
    select m.id, m.created_at from members m
    where m.role = 'alumnus' and m.onboarding_complete and public.is_currently_available_mentor(m.id)
  ), meetings as (
    select x.id, coalesce(x.occurred_at, x.mentor_completed_at, x.mentee_completed_at, x.created_at) happened
    from public.sessions x join members m on m.id = x.mentor_id
    where x.status = 'completed'
  ), requests as (
    select x.id, (x.accepted_at is not null or x.status in ('scheduled', 'completed')) accepted
    from public.sessions x join members m on m.id = x.mentee_id
    where x.created_at >= now() - interval '90 days'
  ), involved as (
    select distinct m.id from members m join public.sessions x on m.id in (x.mentor_id, x.mentee_id)
  ), met as (
    select distinct m.id from members m join public.sessions x on m.id in (x.mentor_id, x.mentee_id) and x.status = 'completed'
  ), invited as (
    -- Everyone the school invited or targeted, plus everyone who joined.
    select lower(trim(i.email)) email from public.invitations i where v_platform or i.organization_id = v_org
    union select lower(trim(o.email)) from public.outreach_targets o where o.email is not null and (v_platform or o.organization_id = v_org)
    union select lower(u.email) from members m join auth.users u on u.id = m.id
  ), wanted as (
    select public.normalize_skill(k.skill) skill_key,
      mode() within group (order by regexp_replace(trim(k.skill), '[.,;:!?]+$', '')) label, count(distinct k.user_id) n
    from public.skills k join members m on m.id = k.user_id
    where k.type = 'wants_to_learn' and public.normalize_skill(k.skill) is not null
    group by public.normalize_skill(k.skill) having count(distinct k.user_id) >= 5
  ), offered as (
    select public.normalize_skill(k.skill) skill_key, count(distinct k.user_id) n
    from public.skills k join alumni_available a on a.id = k.user_id
    where k.type = 'can_teach' and public.normalize_skill(k.skill) is not null group by public.normalize_skill(k.skill)
  ), gaps as (
    select w.label, w.n wanted, coalesce(o.n, 0) offered
    from wanted w left join offered o using (skill_key)
    where coalesce(o.n, 0) < w.n
    order by w.n - coalesce(o.n, 0) desc, w.label limit 5
  ), counts as (
    select
      (select count(*) from members where role = 'student' and onboarding_complete) students,
      (select count(*) from members where role = 'student' and onboarding_complete and created_at >= now() - interval '30 days') students_new,
      (select count(*) from alumni_available) alumni,
      (select count(*) from alumni_available where created_at >= now() - interval '30 days') alumni_new,
      (select count(*) from meetings) meetings,
      (select count(*) from meetings where happened >= now() - interval '30 days') meetings_new,
      (select count(*) from requests) requests,
      (select count(*) from requests where accepted) accepted,
      (select count(*) from invited) invited,
      (select count(*) from members) joined,
      (select count(*) from members where onboarding_complete) profiled,
      (select count(*) from involved) talking,
      (select count(*) from met) met_count
  )
  select jsonb_build_object(
    'headline', jsonb_build_object(
      'students', public.reportable(c.students), 'students_new', public.reportable(c.students_new),
      'alumni_available', public.reportable(c.alumni), 'alumni_new', public.reportable(c.alumni_new),
      'meetings', public.reportable(c.meetings), 'meetings_new', public.reportable(c.meetings_new),
      -- A rate needs five requests behind it, and five on each side of it.
      'acceptance_rate', case when c.requests >= 5 and c.accepted >= 5 and c.requests - c.accepted >= 5
        then round(c.accepted * 100.0 / c.requests) end,
      'requests', public.reportable(c.requests)),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'invited', 'count', public.reportable(greatest(c.invited, c.joined))),
      jsonb_build_object('step', 'joined', 'count', public.reportable(c.joined)),
      jsonb_build_object('step', 'profile', 'count', public.reportable(c.profiled)),
      jsonb_build_object('step', 'talking', 'count', public.reportable(c.talking)),
      jsonb_build_object('step', 'met', 'count', public.reportable(c.met_count))),
    'recruit', coalesce((select jsonb_agg(jsonb_build_object('skill', g.label, 'wanted', g.wanted,
      'offered', public.reportable(g.offered)) order by g.wanted - g.offered desc, g.label) from gaps g), '[]'::jsonb)
  ) from counts c);
end $$;
revoke all on function public.admin_programme_overview() from public, anon;
grant execute on function public.admin_programme_overview() to authenticated;

notify pgrst, 'reload schema';
