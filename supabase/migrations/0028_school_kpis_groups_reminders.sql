-- 0028 School pilot completion pass
--
-- Lean backend hooks for the remaining PM feedback:
-- * school-specific admin KPIs from existing data
-- * student groups without any AI/token dependency
-- * reflection email reminder outbox, ready for a mailer worker

alter table public.profiles
  add column if not exists reflection_email_reminders boolean not null default true;

create table if not exists public.groups (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.group_members (
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists groups_org_idx on public.groups(organization_id);
create index if not exists group_members_user_idx on public.group_members(user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists groups_read_org on public.groups;
create policy groups_read_org on public.groups
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.organization_id = groups.organization_id
  )
);

drop policy if exists group_members_read_org on public.group_members;
create policy group_members_read_org on public.group_members
for select using (
  exists (
    select 1
    from public.groups g
    join public.profiles p on p.organization_id = g.organization_id
    where g.id = group_members.group_id and p.id = auth.uid()
  )
);

create or replace function public.create_group(p_name text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_group_id bigint;
begin
  select organization_id into v_org
  from public.profiles
  where id = v_user and admin_scope = 'none' and deactivated_at is null;

  if v_org is null then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required'; end if;

  insert into public.groups (organization_id, name, description, created_by)
  values (v_org, trim(p_name), left(coalesce(p_description, ''), 280), v_user)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_user, 'owner');

  return jsonb_build_object('id', v_group_id, 'name', trim(p_name));
end;
$function$;

grant execute on function public.create_group(text, text) to authenticated;

create or replace function public.join_group(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.groups g
    join public.profiles p on p.organization_id = g.organization_id
    where g.id = p_group_id and p.id = v_user and p.admin_scope = 'none' and p.deactivated_at is null
  ) then
    raise exception 'not_allowed';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group_id, v_user)
  on conflict do nothing;
end;
$function$;

grant execute on function public.join_group(bigint) to authenticated;

create or replace function public.leave_group(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.group_members
  where group_id = p_group_id and user_id = auth.uid();
end;
$function$;

grant execute on function public.leave_group(bigint) to authenticated;

create or replace function public.my_groups()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_groups jsonb;
begin
  select organization_id into v_org
  from public.profiles
  where id = v_user and admin_scope = 'none' and deactivated_at is null;

  if v_org is null then raise exception 'not_allowed'; end if;

  select coalesce(jsonb_agg(row_to_json(q) order by q.name), '[]'::jsonb)
  into v_groups
  from (
    select
      g.id,
      g.name,
      g.description,
      g.created_at,
      count(gm.user_id)::int as member_count,
      bool_or(gm.user_id = v_user) as joined
    from public.groups g
    left join public.group_members gm on gm.group_id = g.id
    where g.organization_id = v_org
    group by g.id
  ) q;

  return v_groups;
end;
$function$;

grant execute on function public.my_groups() to authenticated;

create table if not exists public.notification_outbox (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email')),
  topic text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists notification_outbox_status_idx
  on public.notification_outbox(status, created_at);

create or replace function public.enqueue_reflection_email_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  insert into public.notification_outbox (user_id, channel, topic, payload, idempotency_key)
  select
    p.id,
    'email',
    'reflection_reminder',
    jsonb_build_object('reason', 'weekly_reflection_due'),
    'reflection:' || p.id::text || ':' || to_char(date_trunc('week', now()), 'YYYY-MM-DD')
  from public.profiles p
  where p.admin_scope = 'none'
    and p.deactivated_at is null
    and p.reflection_email_reminders
    and (
      p.pending_checkin
      or not exists (
        select 1 from public.reflection_logs r
        where r.user_id = p.id and r.created_at > now() - interval '7 days'
      )
    )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.enqueue_reflection_email_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_reflection_email_reminders() to service_role;

select cron.schedule(
  'mt-reflection-email-outbox',
  '0 8 * * 1',
  $$ select public.enqueue_reflection_email_reminders() $$
)
where exists (select 1 from pg_extension where extname = 'pg_cron')
  and not exists (select 1 from cron.job where jobname = 'mt-reflection-email-outbox');

create or replace function public._admin_kpis(p_org uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_total_users int;
  v_onboarded int;
  v_total_students int;
  v_onboarded_students int;
  v_total_alumni int;
  v_onboarded_alumni int;
  v_engaged_alumni int;
  v_meaningful_pairs int;
  v_student_connected int;
  v_requests_sent int;
  v_requests_accepted int;
  v_mentions_continue int;
  v_reflection_count int;
  v_potential_helpers int;
  v_active_helpers int;
  v_paused_helpers int;
  v_participants int;
  v_avg_rating numeric;
  v_pairs_total int;
  v_pairs_repeat int;
  v_avg_response numeric;
  v_cross_program int;
  v_same_program int;
  v_isolated int;
  v_most_requested jsonb;
  v_most_shared jsonb;
  v_gaps jsonb;
  v_growth jsonb;
begin
  select count(*) into v_total_users
  from public.profiles
  where organization_id = p_org and admin_scope = 'none' and deactivated_at is null;

  select count(*) into v_onboarded
  from public.profiles
  where organization_id = p_org and admin_scope = 'none' and deactivated_at is null and onboarding_complete;

  select
    count(*) filter (where coalesce(role, 'student') = 'student'),
    count(*) filter (where coalesce(role, 'student') = 'student' and onboarding_complete),
    count(*) filter (where role = 'alumnus'),
    count(*) filter (where role = 'alumnus' and onboarding_complete)
  into v_total_students, v_onboarded_students, v_total_alumni, v_onboarded_alumni
  from public.profiles
  where organization_id = p_org and admin_scope = 'none' and deactivated_at is null;

  select count(distinct p.id) into v_potential_helpers
  from public.profiles p
  join public.skills s on s.user_id = p.id and s.type = 'can_teach'
  where p.organization_id = p_org and p.admin_scope = 'none' and p.deactivated_at is null;

  select count(distinct s.mentor_id) into v_active_helpers
  from public.sessions s
  join public.profiles p on p.id = s.mentor_id
  where p.organization_id = p_org and s.status = 'completed';

  select count(*) into v_paused_helpers
  from public.profiles p
  where p.organization_id = p_org and p.admin_scope = 'none' and p.deactivated_at is null
    and exists (select 1 from public.skills sk where sk.user_id = p.id and sk.type = 'can_teach')
    and not public.is_currently_available_mentor(p.id);

  select count(distinct uid) into v_participants
  from (
    select s.mentor_id as uid from public.sessions s join public.profiles p on p.id = s.mentor_id where p.organization_id = p_org
    union
    select s.mentee_id from public.sessions s join public.profiles p on p.id = s.mentee_id where p.organization_id = p_org
  ) z;

  select round(avg(r), 2) into v_avg_rating
  from (
    select s.mentee_rating as r from public.sessions s join public.profiles p on p.id = s.mentor_id
      where p.organization_id = p_org and s.status = 'completed' and s.mentee_rating is not null
    union all
    select s.mentor_rating from public.sessions s join public.profiles p on p.id = s.mentor_id
      where p.organization_id = p_org and s.status = 'completed' and s.mentor_rating is not null
  ) z;

  with pairs as (
    select least(s.mentor_id, s.mentee_id) as a, greatest(s.mentor_id, s.mentee_id) as b, count(*) as n
    from public.sessions s
    join public.profiles p on p.id = s.mentor_id
    where p.organization_id = p_org and s.status = 'completed'
    group by 1, 2
  )
  select count(*), count(*) filter (where n > 1) into v_pairs_total, v_pairs_repeat from pairs;

  select round(avg(extract(epoch from (s.scheduled_at - s.created_at)) / 3600.0)::numeric, 1)
  into v_avg_response
  from public.sessions s
  join public.profiles p on p.id = s.mentor_id
  where p.organization_id = p_org
    and s.scheduled_at is not null
    and s.scheduled_at > s.created_at
    and s.status in ('scheduled', 'completed');

  select
    count(*) filter (where mp.program is distinct from ep.program),
    count(*) filter (where mp.program is not distinct from ep.program)
  into v_cross_program, v_same_program
  from public.sessions s
  join public.profiles mp on mp.id = s.mentor_id
  join public.profiles ep on ep.id = s.mentee_id
  where mp.organization_id = p_org and s.status = 'completed';

  select count(*) into v_isolated
  from public.profiles p
  where p.organization_id = p_org and p.admin_scope = 'none' and p.deactivated_at is null and p.onboarding_complete
    and not exists (
      select 1 from public.sessions s where s.mentor_id = p.id or s.mentee_id = p.id
    );

  select count(*) into v_requests_sent
  from public.sessions s
  join public.profiles p on p.id = s.mentee_id
  where p.organization_id = p_org;

  select count(*) into v_requests_accepted
  from public.sessions s
  join public.profiles p on p.id = s.mentee_id
  where p.organization_id = p_org and s.status in ('scheduled', 'completed');

  select count(distinct s.mentor_id) into v_engaged_alumni
  from public.sessions s
  join public.profiles p on p.id = s.mentor_id
  where p.organization_id = p_org and p.role = 'alumnus' and s.status in ('scheduled', 'completed');

  select count(*) into v_meaningful_pairs
  from (
    select least(s.mentor_id, s.mentee_id) as a, greatest(s.mentor_id, s.mentee_id) as b
    from public.sessions s
    join public.profiles p on p.id = s.mentee_id
    where p.organization_id = p_org and s.status in ('scheduled', 'completed')
    union
    select least(c.requester_id, c.addressee_id), greatest(c.requester_id, c.addressee_id)
    from public.connections c
    join public.profiles p on p.id = c.requester_id
    where p.organization_id = p_org and c.status = 'accepted'
  ) q;

  select count(distinct p.id) into v_student_connected
  from public.profiles p
  where p.organization_id = p_org and p.role = 'student' and p.onboarding_complete and p.deactivated_at is null
    and exists (
      select 1 from public.sessions s
      where s.status in ('scheduled', 'completed') and (s.mentor_id = p.id or s.mentee_id = p.id)
    );

  select count(*) into v_reflection_count
  from public.reflection_logs r
  join public.profiles p on p.id = r.user_id
  where p.organization_id = p_org;

  select count(*) into v_mentions_continue
  from public.reflection_logs r
  join public.profiles p on p.id = r.user_id
  where p.organization_id = p_org
    and (r.support_needed || ' ' || r.managed_well) ~* '(continue|keep using|next term|again|keep going)';

  select coalesce(jsonb_agg(x order by (x->>'count')::int desc, lower(x->>'skill')), '[]'::jsonb)
  into v_most_requested
  from (
    select jsonb_build_object('skill', s.skill, 'count', count(distinct s.user_id)) as x
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'wants_to_learn'
    group by s.skill order by count(distinct s.user_id) desc, lower(s.skill) limit 10
  ) q;

  select coalesce(jsonb_agg(x order by (x->>'count')::int desc, lower(x->>'skill')), '[]'::jsonb)
  into v_most_shared
  from (
    select jsonb_build_object('skill', s.skill, 'count', count(distinct s.user_id)) as x
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'can_teach'
    group by s.skill order by count(distinct s.user_id) desc, lower(s.skill) limit 10
  ) q;

  with demand as (
    select lower(trim(s.skill)) as skill, count(distinct s.user_id) as d
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'wants_to_learn' group by 1
  ),
  supply as (
    select lower(trim(s.skill)) as skill, count(distinct s.user_id) as su
    from public.skills s join public.profiles p on p.id = s.user_id
    where p.organization_id = p_org and s.type = 'can_teach' group by 1
  )
  select coalesce(jsonb_agg(q.x order by q.gap desc, q.skill), '[]'::jsonb)
  into v_gaps
  from (
    select d.skill as skill, (d.d - coalesce(su.su, 0)) as gap,
           jsonb_build_object('skill', d.skill, 'demand', d.d, 'supply', coalesce(su.su, 0)) as x
    from demand d left join supply su on su.skill = d.skill
    where d.d - coalesce(su.su, 0) > 0
    order by gap desc, d.skill
    limit 10
  ) q;

  with months as (
    select generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as m
  ),
  per as (
    select date_trunc('month', s.created_at) as m, count(*) as cnt
    from public.sessions s join public.profiles p on p.id = s.mentor_id
    where p.organization_id = p_org group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(months.m, 'YYYY-MM'), 'sessions', coalesce(per.cnt, 0)) order by months.m), '[]'::jsonb)
  into v_growth
  from months left join per on per.m = months.m;

  return jsonb_build_object(
    'totalUsers', v_total_users,
    'onboarded', v_onboarded,
    'studentActivationRate', case when v_total_students = 0 then 0 else round(v_onboarded_students * 100.0 / v_total_students) end,
    'alumniActivationRate', case when v_total_alumni = 0 then 0 else round(v_onboarded_alumni * 100.0 / v_total_alumni) end,
    'alumniEngagementRate', case when v_onboarded_alumni = 0 then 0 else round(v_engaged_alumni * 100.0 / v_onboarded_alumni) end,
    'meaningfulConnections', coalesce(v_meaningful_pairs, 0),
    'connectionCoverageRate', case when v_onboarded_students = 0 then 0 else round(v_student_connected * 100.0 / v_onboarded_students) end,
    'acceptanceRate', case when v_requests_sent = 0 then 0 else round(v_requests_accepted * 100.0 / v_requests_sent) end,
    'replyRate', null,
    'mentorshipsFormed', coalesce(v_pairs_repeat, 0),
    'careerConversations', coalesce(v_meaningful_pairs, 0),
    'intentToContinueRate', case when v_reflection_count = 0 then 0 else round(v_mentions_continue * 100.0 / v_reflection_count) end,
    'potentialMentors', v_potential_helpers,
    'activeMentors', v_active_helpers,
    'inactiveMentors', greatest(0, v_potential_helpers - v_active_helpers),
    'pausedMentors', v_paused_helpers,
    'participationRate', case when v_onboarded = 0 then 0 else round(v_participants * 100.0 / v_onboarded) end,
    'avgRating', coalesce(v_avg_rating, 0),
    'repeatRate', case when v_pairs_total = 0 then 0 else round(v_pairs_repeat * 100.0 / v_pairs_total) end,
    'avgResponseHours', coalesce(v_avg_response, 0),
    'crossDeptSessions', coalesce(v_cross_program, 0),
    'sameDeptSessions', coalesce(v_same_program, 0),
    'isolatedEmployees', v_isolated,
    'mostRequested', v_most_requested,
    'mostShared', v_most_shared,
    'demandSupplyGaps', v_gaps,
    'growth', v_growth
  );
end;
$function$;
