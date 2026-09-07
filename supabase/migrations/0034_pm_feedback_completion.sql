-- Close the remaining PM-feedback data gaps: retain reviewed request copy and
-- keep KPI numerators inside their documented activation denominators.

alter table public.sessions
  add column if not exists outbound_message text;

alter table public.sessions
  drop constraint if exists sessions_outbound_message_length;
alter table public.sessions
  add constraint sessions_outbound_message_length
  check (outbound_message is null or char_length(outbound_message) <= 6000);

create or replace function public.pm_set_outbound_message(p_session_id bigint, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); session_row public.sessions;
begin
  if caller is null then raise exception 'auth_required'; end if;
  if char_length(trim(coalesce(p_message, ''))) not between 1 and 6000 then
    raise exception 'invalid_outbound_message';
  end if;
  select * into session_row from public.sessions where id = p_session_id for update;
  if not found or session_row.mentee_id <> caller then raise exception 'not_allowed'; end if;
  update public.sessions set outbound_message = trim(p_message) where id = p_session_id;
  insert into public.audit_logs(actor_id, action, target_type, target_id)
  values (caller, 'session_outbound_message_set', 'session', p_session_id::text);
  return jsonb_build_object('id', p_session_id, 'saved', true);
end; $$;
revoke all on function public.pm_set_outbound_message(bigint, text) from public, anon;
grant execute on function public.pm_set_outbound_message(bigint, text) to authenticated;

create or replace function public.admin_pm_kpis(p_org uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid(); org uuid; as_of timestamptz := now();
  student_invited integer; student_active integer; alumni_targeted integer; alumni_active integer;
  alumni_engaged integer; meaningful integer; connected_students integer; requests_sent integer;
  accepted integer; replied integer; mentorships integer; conversations integer; referrals integer;
  intent_total integer; intent_yes integer; metric jsonb := '{}'::jsonb;
begin
  if not public.is_admin(caller) then raise exception 'admin_only'; end if;
  if p_org is not null and public.is_platform_admin(caller) then org := p_org;
  else select organization_id into org from public.profiles where id=caller; end if;
  if org is null then raise exception 'no_org'; end if;

  select count(distinct coalesce(profile_id::text, lower(email))) filter(where persona='student'),
         count(distinct coalesce(profile_id::text, lower(email))) filter(where persona='student' and profile_id is not null and exists(select 1 from public.profiles p where p.id=outreach_targets.profile_id and p.onboarding_complete and p.deactivated_at is null)),
         count(distinct coalesce(profile_id::text, lower(email))) filter(where persona='alumnus'),
         count(distinct coalesce(profile_id::text, lower(email))) filter(where persona='alumnus' and profile_id is not null and exists(select 1 from public.profiles p where p.id=outreach_targets.profile_id and p.onboarding_complete and p.deactivated_at is null))
  into student_invited,student_active,alumni_targeted,alumni_active from public.outreach_targets where organization_id=org and not is_demo;

  -- Engagement must only count activated alumni, otherwise the numerator can
  -- exceed the targeted-alumni denominator.
  select count(distinct p.id) into alumni_engaged from public.profiles p
  where p.organization_id=org and p.role='alumnus' and p.onboarding_complete and p.deactivated_at is null
    and exists(select 1 from public.outreach_targets target where target.organization_id=org and target.profile_id=p.id and target.persona='alumnus' and not target.is_demo)
    and (exists(select 1 from public.outcome_events e where e.organization_id=org and not e.is_demo and e.actor_id=p.id)
      or exists(select 1 from public.sessions s where s.mentor_id=p.id and s.status='completed'));

  with pairs as (
    select least(s.mentor_id,s.mentee_id) a, greatest(s.mentor_id,s.mentee_id) b from public.sessions s join public.profiles p on p.id=s.mentor_id where p.organization_id=org and s.status='completed'
    union
    select least(e.actor_id,e.recipient_id), greatest(e.actor_id,e.recipient_id) from public.outcome_events e where e.organization_id=org and not e.is_demo and e.kind in ('meeting','career_conversation','referral') and e.recipient_id is not null
    union
    select least(e.actor_id,e.recipient_id), greatest(e.actor_id,e.recipient_id) from public.outcome_events e where e.organization_id=org and not e.is_demo and e.kind='human_reply' and e.recipient_id is not null group by least(e.actor_id,e.recipient_id),greatest(e.actor_id,e.recipient_id) having count(distinct e.actor_id)=2
  ) select count(*), count(distinct x.id) filter(where x.role='student' and exists(
    select 1 from public.outreach_targets target where target.organization_id=org and target.profile_id=x.id and target.persona='student' and not target.is_demo
  )) into meaningful,connected_students from pairs join lateral (values(a),(b)) q(id) on true join public.profiles x on x.id=q.id;

  select count(*), count(*) filter(where accepted_at is not null or status in ('scheduled','completed')) into requests_sent,accepted from public.sessions s join public.profiles p on p.id=s.mentor_id where p.organization_id=org;
  select count(distinct e.session_id) into replied from public.outcome_events e where e.organization_id=org and e.kind='human_reply' and not e.is_demo;
  with confirmed as (select least(actor_id,recipient_id) a,greatest(actor_id,recipient_id) b from public.outcome_events where organization_id=org and kind='mentorship_confirmed' and not is_demo and recipient_id is not null group by 1,2 having count(distinct actor_id)=2) select count(*) into mentorships from confirmed;
  select count(*) filter(where kind='career_conversation'),count(*) filter(where kind='referral') into conversations,referrals from public.outcome_events where organization_id=org and not is_demo;
  select count(*),count(*) filter(where answer='yes') into intent_total,intent_yes from public.continuation_intents where organization_id=org and not is_demo;
  metric := jsonb_build_object(
    'studentActivationRate',jsonb_build_object('value',case when student_invited>0 then round(student_active*100.0/student_invited) end,'numerator',student_active,'denominator',student_invited,'available',student_invited>0),
    'alumniActivationRate',jsonb_build_object('value',case when alumni_targeted>0 then round(alumni_active*100.0/alumni_targeted) end,'numerator',alumni_active,'denominator',alumni_targeted,'available',alumni_targeted>0),
    'alumniEngagementRate',jsonb_build_object('value',case when alumni_active>0 then round(alumni_engaged*100.0/alumni_active) end,'numerator',alumni_engaged,'denominator',alumni_active,'available',alumni_active>0),
    'meaningfulConnections',jsonb_build_object('value',meaningful,'numerator',meaningful,'available',true),
    'connectionCoverageRate',jsonb_build_object('value',case when student_active>0 then round(connected_students*100.0/student_active) end,'numerator',connected_students,'denominator',student_active,'available',student_active>0),
    'acceptanceRate',jsonb_build_object('value',case when requests_sent>0 then round(accepted*100.0/requests_sent) end,'numerator',accepted,'denominator',requests_sent,'available',requests_sent>0),
    'replyRate',jsonb_build_object('value',case when accepted>0 then round(replied*100.0/accepted) end,'numerator',replied,'denominator',accepted,'available',accepted>0),
    'mentorshipsFormed',jsonb_build_object('value',mentorships,'numerator',mentorships,'available',true),
    'careerConversations',jsonb_build_object('value',conversations,'numerator',conversations,'available',true),
    'referrals',jsonb_build_object('value',referrals,'numerator',referrals,'available',true),
    'intentToContinueRate',jsonb_build_object('value',case when intent_total>0 then round(intent_yes*100.0/intent_total) end,'numerator',intent_yes,'denominator',intent_total,'responseRate',case when intent_total>0 then 100 else null end,'available',intent_total>0)
  );
  return jsonb_build_object('metadata',metric,'reporting',jsonb_build_object('period','All recorded outcomes','cohort','All','asOf',as_of));
end; $$;
revoke all on function public.admin_pm_kpis(uuid) from public, anon;
grant execute on function public.admin_pm_kpis(uuid) to authenticated;
