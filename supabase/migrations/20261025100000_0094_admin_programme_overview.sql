-- What an alumni team needs on one screen: is the programme working, where do
-- people drop off, and which alumni to recruit. School-wide totals only, and
-- any count under five is sent as null, as everywhere else in admin reporting.
--
-- headline   students with a completed profile, alumni available to mentor,
--            completed meetings, and the share of requests accepted in the
--            last 90 days; each with what changed in the last 30 days
-- funnel     invited, joined, completed profile, in a conversation (sent or
--            received a request), met (a completed meeting)
-- recruit    up to five skills that at least five members want and that
--            fewer available alumni offer, the widest gap first

-- Shared rule: a count is shown from five up, otherwise null.
create or replace function public.reportable(n bigint)
returns integer language sql immutable as $$ select case when n >= 5 then n::int end $$;

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
    select lower(trim(k.skill)) skill_key, min(trim(k.skill)) label, count(distinct k.user_id) n
    from public.skills k join members m on m.id = k.user_id
    where k.type = 'wants_to_learn' and coalesce(trim(k.skill), '') <> ''
    group by lower(trim(k.skill)) having count(distinct k.user_id) >= 5
  ), offered as (
    select lower(trim(k.skill)) skill_key, count(distinct k.user_id) n
    from public.skills k join alumni_available a on a.id = k.user_id
    where k.type = 'can_teach' group by lower(trim(k.skill))
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
