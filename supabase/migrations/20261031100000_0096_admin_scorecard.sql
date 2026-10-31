-- The admin scorecard: success, impact and scalability in eight numbers.
--
-- meeting_benefits  after a meeting, the student can say whether it helped
--                   with a decision, an application or a next step (yes /
--                   somewhat / no). One answer per student per meeting,
--                   written only through record_meeting_benefit. Included in
--                   the member's data export and removed on erasure.
-- admin_scorecard   the figures the existing KPIs do not cover: new
--                   meaningful connections in the last 30 days, the share of
--                   completed meetings across two fields of study and how many
--                   field pairs that links, the share of students who said a
--                   meeting helped, how much of available alumni's monthly
--                   capacity is in use, and the median time to a first reply.
--                   School-wide figures only; a figure built on fewer than
--                   five people or meetings is sent as null.

create table public.meeting_benefits (
  session_id bigint not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer text not null check (answer in ('yes', 'somewhat', 'no')),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.meeting_benefits enable row level security;
revoke all on public.meeting_benefits from public, anon, authenticated;
grant select on public.meeting_benefits to authenticated;
create policy meeting_benefits_own_read on public.meeting_benefits
  for select to authenticated using (user_id = auth.uid());

create or replace function public.record_meeting_benefit(p_session_id bigint, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth_required'; end if;
  if p_answer not in ('yes', 'somewhat', 'no') then raise exception 'invalid_answer'; end if;
  -- Only the student who asked for the meeting, and only once it took place.
  if not exists (select 1 from public.sessions s where s.id = p_session_id and s.mentee_id = me
    and (s.status = 'completed' or s.mentee_completed_at is not null)) then
    raise exception 'not_allowed';
  end if;
  insert into public.meeting_benefits (session_id, user_id, answer) values (p_session_id, me, p_answer)
  on conflict (session_id, user_id) do update set answer = excluded.answer, created_at = now();
  return jsonb_build_object('answer', p_answer);
end $$;
revoke all on function public.record_meeting_benefit(bigint, text) from public, anon;
grant execute on function public.record_meeting_benefit(bigint, text) to authenticated;

create or replace function public.erase_account_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target public.profiles; cancelled integer; next_owner uuid; owned record;
begin
  select * into target from public.profiles where id = p_user_id for update;
  if target.id is null then raise exception 'user_not_found'; end if;
  if target.admin_scope <> 'none' or target.is_admin then raise exception 'admin_account'; end if;

  -- Nobody is left waiting on a request or a meeting with this person.
  update public.sessions set status = 'cancelled'
    where p_user_id in (mentor_id, mentee_id) and status in ('pending', 'scheduled');
  get diagnostics cancelled = row_count;
  -- Shared sessions stay for the other person; this member's words leave them.
  update public.sessions set outbound_message = '', pre_session_question = '', reflection = '', mentee_rating = null
    where mentee_id = p_user_id;
  update public.sessions set mentor_reflection = '', mentor_rating = null where mentor_id = p_user_id;
  delete from public.session_messages where sender_id = p_user_id;
  delete from public.session_reads where user_id = p_user_id;

  -- A group they own passes to its longest-standing member, or closes if empty.
  for owned in select id from public.groups where created_by = p_user_id loop
    select user_id into next_owner from public.group_members
      where group_id = owned.id and user_id <> p_user_id order by created_at, user_id limit 1;
    if next_owner is null then
      delete from public.groups where id = owned.id;
    else
      update public.groups set created_by = next_owner where id = owned.id;
      update public.group_members set role = 'owner' where group_id = owned.id and user_id = next_owner;
    end if;
  end loop;
  delete from public.group_messages where sender_id = p_user_id;
  delete from public.group_members where user_id = p_user_id;
  delete from public.group_join_requests where user_id = p_user_id;
  delete from public.group_reads where user_id = p_user_id;

  delete from public.skills where user_id = p_user_id;
  delete from public.career_history where user_id = p_user_id;
  delete from public.profile_drafts where user_id = p_user_id;
  delete from public.reflection_logs where user_id = p_user_id;
  delete from public.mentorship_unavailable_periods where user_id = p_user_id;
  delete from public.connections where p_user_id in (requester_id, addressee_id);
  delete from public.match_scores where p_user_id in (user_a_id, user_b_id);
  delete from public.discovery_threads where user_id = p_user_id;
  delete from public.discovery_feedback where user_id = p_user_id;
  update public.discovery_feedback set profile_id = null where profile_id = p_user_id;
  update public.discovery_threads set selected_person_id = null where selected_person_id = p_user_id;
  delete from public.feedback_messages where user_id = p_user_id;
  delete from public.continuation_intents where user_id = p_user_id;
  delete from public.outcome_events where actor_id = p_user_id;
  update public.outcome_events set recipient_id = null where recipient_id = p_user_id;
  delete from public.calendar_connections where user_id = p_user_id;
  delete from public.calendar_events where owner_id = p_user_id;
  delete from public.calendar_event_claims where owner_id = p_user_id;
  delete from public.notification_outbox where user_id = p_user_id;
  delete from public.consent_records where user_id = p_user_id;
  delete from public.meeting_benefits where user_id = p_user_id;
  update public.ai_runs set user_id = null where user_id = p_user_id;
  update public.outreach_targets set email = null where profile_id = p_user_id;
  update public.invitations set email = 'erased-' || id || '@invalid', profile_data = '{}'::jsonb
    where accepted_user_id = p_user_id;

  update public.profiles set
    name = 'Former member', department = '', job_title = '', bio = '', location = '',
    shadow_role_response = '', program = '', cohort_year = null, tenure_years = 0,
    linkedin_url = null, linkedin_headline = null, notification_email = null,
    external_source = null, external_id = null, source_synced_at = null, manager_id = null,
    mentorship_note = null, mentorship_paused = true, reflection_email_reminders = false,
    ai_opt_out = true, onboarding_complete = false,
    deactivated_at = coalesce(deactivated_at, now()), erased_at = now()
  where id = p_user_id;
  update public.profiles set manager_id = null where manager_id = p_user_id;

  return jsonb_build_object('erased', true, 'cancelled_sessions', cancelled);
end $$;

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth_required'; end if;
  return jsonb_build_object(
    'format', 'ment-export-1',
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = me),
    'skills', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.skills x where x.user_id = me),
    'career_history', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.career_history x where x.user_id = me),
    'profile_drafts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.profile_drafts x where x.user_id = me),
    'reflections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.reflection_logs x where x.user_id = me),
    'unavailable_periods', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.mentorship_unavailable_periods x where x.user_id = me),
    'connections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.connections x where me in (x.requester_id, x.addressee_id)),
    'sessions', (select coalesce(jsonb_agg(
        to_jsonb(s) - 'route_token' - (case when s.mentor_id = me
          then array['reflection', 'mentee_rating'] else array['mentor_reflection', 'mentor_rating'] end)
        order by s.id), '[]')
      from public.sessions s where me in (s.mentor_id, s.mentee_id)),
    'session_messages_sent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.session_messages x where x.sender_id = me),
    'groups_created', (select coalesce(jsonb_agg(to_jsonb(x) - 'route_token' order by x.id), '[]') from public.groups x where x.created_by = me),
    'group_memberships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_members x where x.user_id = me),
    'group_join_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_join_requests x where x.user_id = me),
    'group_messages_sent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.group_messages x where x.sender_id = me),
    'discovery_threads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.discovery_threads x where x.user_id = me),
    'discovery_feedback', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.discovery_feedback x where x.user_id = me),
    'feedback', (select coalesce(jsonb_agg(to_jsonb(x) - 'reviewed_by'), '[]') from public.feedback_messages x where x.user_id = me),
    'continuation_intents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.continuation_intents x where x.user_id = me),
    'outcome_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.outcome_events x where x.actor_id = me),
    'calendar_connections', (select coalesce(jsonb_agg(to_jsonb(x) - 'token_ciphertext' - 'refresh_ciphertext'), '[]') from public.calendar_connections x where x.user_id = me),
    'calendar_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.calendar_events x where x.owner_id = me),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.notification_outbox x where x.user_id = me),
    'consents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.accepted_at), '[]') from public.consent_records x where x.user_id = me),
    'meeting_benefits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.meeting_benefits x where x.user_id = me)
  );
end $$;

create or replace function public.admin_scorecard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return (with members as (
    select p.id, p.role, p.onboarding_complete, p.monthly_meeting_limit,
      case when count(*) over (partition by nullif(trim(p.department), '')) >= 5 then nullif(trim(p.department), '') end field
    from public.profiles p
    where p.admin_scope = 'none' and p.deactivated_at is null and (v_platform or p.organization_id = v_org)
  ), completed as (
    select x.id, x.mentor_id, x.mentee_id, coalesce(x.occurred_at, x.mentor_completed_at, x.mentee_completed_at, x.created_at) happened,
      a.field mentor_field, b.field mentee_field
    from public.sessions x join members a on a.id = x.mentor_id join members b on b.id = x.mentee_id
    where x.status = 'completed'
  ), pair_firsts as (
    -- A pair counts from its first completed meeting or the first time both had written.
    select least(a, b) a, greatest(a, b) b, min(at) first_at from (
      select mentor_id a, mentee_id b, happened at from completed
      union all
      select x.mentor_id, x.mentee_id, greatest(min(m.created_at) filter (where m.sender_id = x.mentor_id), min(m.created_at) filter (where m.sender_id = x.mentee_id))
      from public.sessions x join members a on a.id = x.mentor_id
      join public.session_messages m on m.session_id = x.id and m.kind = 'message'
      group by x.id, x.mentor_id, x.mentee_id
      having count(distinct m.sender_id) filter (where m.sender_id in (x.mentor_id, x.mentee_id)) = 2
    ) events where at is not null group by least(a, b), greatest(a, b)
  ), known_fields as (
    select * from completed where mentor_field is not null and mentee_field is not null
  ), alumni_available as (
    select m.id, coalesce(m.monthly_meeting_limit, 0) monthly_limit from members m
    where m.role = 'alumnus' and m.onboarding_complete and public.is_currently_available_mentor(m.id)
  ), booked as (
    select count(*) n from public.sessions x join alumni_available a on a.id = x.mentor_id
    where x.status in ('scheduled', 'completed')
      and coalesce(x.scheduled_at, x.accepted_at, x.created_at) >= date_trunc('month', now())
      and coalesce(x.scheduled_at, x.accepted_at, x.created_at) < date_trunc('month', now()) + interval '1 month'
  ), replies as (
    -- From a request to the alumnus's first message or acceptance, whichever came first.
    select extract(epoch from (least(x.accepted_at, (select min(m.created_at) from public.session_messages m
        where m.session_id = x.id and m.sender_id = x.mentor_id and m.kind = 'message')) - x.created_at)) / 3600 hours
    from public.sessions x join members a on a.id = x.mentor_id
    where x.created_at >= now() - interval '90 days'
  ), benefits as (
    select b.answer from public.meeting_benefits b join members m on m.id = b.user_id
  ), c as (
    select
      (select count(*) from pair_firsts where first_at >= now() - interval '30 days') new_pairs,
      (select count(*) from known_fields) known,
      (select count(*) from known_fields where mentor_field <> mentee_field) crossing,
      (select count(distinct (least(mentor_field, mentee_field), greatest(mentor_field, mentee_field))) from known_fields where mentor_field <> mentee_field) field_pairs,
      (select count(*) from benefits) answered,
      (select count(*) from benefits where answer = 'yes') helped,
      (select count(*) from alumni_available) alumni,
      (select sum(monthly_limit) from alumni_available) capacity,
      (select n from booked) booked,
      (select count(*) from replies where hours is not null and hours >= 0) replied,
      (select percentile_cont(0.5) within group (order by hours) from replies where hours is not null and hours >= 0) median_hours
  )
  select jsonb_build_object(
    'new_connections_30d', public.reportable(c.new_pairs),
    'cross_field_share', case when c.known >= 5 and c.crossing >= 5 and c.known - c.crossing >= 5
      then round(c.crossing * 100.0 / c.known) end,
    'cross_field_pairs', case when c.crossing >= 5 then c.field_pairs end,
    'benefit_rate', case when c.answered >= 5 then round(c.helped * 100.0 / c.answered) end,
    'benefit_answers', public.reportable(c.answered),
    'capacity_used', case when c.alumni >= 5 and c.capacity > 0 then round(c.booked * 100.0 / c.capacity) end,
    'median_reply_hours', case when c.replied >= 5 then round(c.median_hours::numeric, 1) end
  ) from c);
end $$;
revoke all on function public.admin_scorecard() from public, anon;
grant execute on function public.admin_scorecard() to authenticated;

notify pgrst, 'reload schema';
