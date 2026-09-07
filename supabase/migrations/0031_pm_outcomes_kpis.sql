-- PM page 9: explicit, auditable outcome evidence for school reporting.
-- The tables deliberately store events, never private message/reflection bodies.

create table public.outreach_targets (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  email text,
  persona text not null check (persona in ('student', 'alumnus')),
  cohort_term text not null default 'All',
  invited_at timestamptz not null default now(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  check (profile_id is not null or email is not null)
);
create unique index outreach_targets_profile_term on public.outreach_targets(organization_id, profile_id, cohort_term)
  where profile_id is not null;

create table public.outcome_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id bigint references public.sessions(id) on delete set null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('human_reply', 'meeting', 'career_conversation', 'referral', 'mentorship_confirmed')),
  idempotency_key uuid not null,
  occurred_at timestamptz not null default now(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key)
);
create index outcome_events_org_kind_date on public.outcome_events(organization_id, kind, occurred_at desc);
create index outcome_events_session_kind on public.outcome_events(session_id, kind);

create table public.continuation_intents (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cohort_term text not null,
  answer text not null check (answer in ('yes', 'no', 'unsure')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, cohort_term)
);

alter table public.outreach_targets enable row level security;
alter table public.outcome_events enable row level security;
alter table public.continuation_intents enable row level security;
revoke all on public.outreach_targets, public.outcome_events, public.continuation_intents from public, anon, authenticated;
grant all on public.outreach_targets, public.outcome_events, public.continuation_intents to service_role;

create function public.pm_record_outcome(
  p_session_id bigint, p_kind text, p_idempotency_key uuid, p_occurred_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); s public.sessions; actor public.profiles; other uuid; result jsonb;
begin
  if caller is null then raise exception 'auth_required'; end if;
  if p_kind not in ('human_reply', 'meeting', 'career_conversation', 'referral', 'mentorship_confirmed') then
    raise exception 'invalid_outcome_kind';
  end if;
  select * into s from public.sessions where id = p_session_id;
  if not found or caller not in (s.mentor_id, s.mentee_id) then raise exception 'not_allowed'; end if;
  if p_kind = 'human_reply' and s.accepted_at is null and s.status not in ('scheduled', 'completed') then
    raise exception 'outcome_requires_accepted_session';
  end if;
  select * into actor from public.profiles where id = caller and deactivated_at is null;
  if actor.id is null then raise exception 'not_allowed'; end if;
  other := case when caller = s.mentor_id then s.mentee_id else s.mentor_id end;
  insert into public.outcome_events(organization_id, session_id, actor_id, recipient_id, kind, idempotency_key, occurred_at)
  values(actor.organization_id, s.id, caller, other, p_kind, p_idempotency_key, least(coalesce(p_occurred_at, now()), now()))
  on conflict (actor_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning jsonb_build_object('id', id, 'kind', kind, 'occurredAt', occurred_at) into strict result;
  return result;
end; $$;

create function public.pm_record_continuation_intent(p_cohort_term text, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); profile public.profiles; result jsonb;
begin
  if p_answer not in ('yes','no','unsure') or char_length(trim(coalesce(p_cohort_term,''))) not between 1 and 100 then
    raise exception 'invalid_intent_response';
  end if;
  select * into profile from public.profiles where id=caller and deactivated_at is null;
  if profile.id is null then raise exception 'not_allowed'; end if;
  insert into public.continuation_intents(organization_id,user_id,cohort_term,answer)
  values(profile.organization_id,caller,trim(p_cohort_term),p_answer)
  on conflict (organization_id,user_id,cohort_term) do update set answer=excluded.answer,created_at=now()
  returning jsonb_build_object('answer',answer,'cohortTerm',cohort_term,'recordedAt',created_at) into strict result;
  return result;
end; $$;

create function public.pm_upsert_outreach_target(
  p_profile_id uuid, p_email text, p_persona text, p_cohort_term text default 'All'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); org uuid; target public.profiles; result jsonb;
begin
  if not public.is_admin(caller) then raise exception 'admin_only'; end if;
  select organization_id into org from public.profiles where id=caller;
  if p_profile_id is not null then
    select * into target from public.profiles where id=p_profile_id;
    if target.id is null or target.organization_id is distinct from org then raise exception 'invalid_target'; end if;
  end if;
  insert into public.outreach_targets(organization_id,profile_id,email,persona,cohort_term)
  values(org,p_profile_id,nullif(lower(trim(p_email)),''),p_persona,coalesce(nullif(trim(p_cohort_term),''),'All'))
  on conflict (organization_id,profile_id,cohort_term) where profile_id is not null do update set persona=excluded.persona,email=coalesce(excluded.email,outreach_targets.email)
  returning jsonb_build_object('id',id,'persona',persona,'cohortTerm',cohort_term) into strict result;
  return result;
end; $$;

create function public.admin_pm_kpis(p_org uuid default null)
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

  select count(distinct p.id) into alumni_engaged from public.profiles p where p.organization_id=org and p.role='alumnus' and p.onboarding_complete and p.deactivated_at is null and (
    exists(select 1 from public.outcome_events e where e.organization_id=org and not e.is_demo and e.actor_id=p.id) or
    exists(select 1 from public.sessions s where s.mentor_id=p.id and s.status='completed')
  );
  with pairs as (
    select least(s.mentor_id,s.mentee_id) a, greatest(s.mentor_id,s.mentee_id) b from public.sessions s join public.profiles p on p.id=s.mentor_id where p.organization_id=org and s.status='completed'
    union
    select least(e.actor_id,e.recipient_id), greatest(e.actor_id,e.recipient_id) from public.outcome_events e where e.organization_id=org and not e.is_demo and e.kind in ('meeting','career_conversation','referral') and e.recipient_id is not null
    union
    select least(e.actor_id,e.recipient_id), greatest(e.actor_id,e.recipient_id) from public.outcome_events e where e.organization_id=org and not e.is_demo and e.kind='human_reply' and e.recipient_id is not null group by least(e.actor_id,e.recipient_id),greatest(e.actor_id,e.recipient_id) having count(distinct e.actor_id)=2
  ) select count(*), count(distinct x.user_id) filter(where x.role='student') into meaningful,connected_students from pairs join lateral (values(a),(b)) q(id) on true join public.profiles x on x.id=q.id;
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

revoke all on function public.pm_record_outcome(bigint,text,uuid,timestamptz), public.pm_record_continuation_intent(text,text), public.pm_upsert_outreach_target(uuid,text,text,text), public.admin_pm_kpis(uuid) from public, anon;
grant execute on function public.pm_record_outcome(bigint,text,uuid,timestamptz), public.pm_record_continuation_intent(text,text), public.pm_upsert_outreach_target(uuid,text,text,text), public.admin_pm_kpis(uuid) to authenticated;
