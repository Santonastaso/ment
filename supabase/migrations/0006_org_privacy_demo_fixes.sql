-- PM feedback pass: org foundation, redacted directory access, and scoped admin views.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'MENT Demo', 'ment-demo')
on conflict (id) do nothing;

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

alter table public.profiles
  add column if not exists admin_scope text not null default 'none'
  check (admin_scope in ('none', 'org', 'platform'));

alter table public.profiles
  alter column organization_id set default '00000000-0000-0000-0000-000000000001'::uuid;

update public.profiles
set organization_id = '00000000-0000-0000-0000-000000000001'::uuid
where organization_id is null;

update public.profiles
set admin_scope = case when is_admin then 'platform' else 'none' end
where admin_scope = 'none';

update public.profiles
set is_admin = admin_scope in ('org', 'platform');

alter table public.profiles
  alter column organization_id set not null;

create index if not exists profiles_org_idx on public.profiles(organization_id);
create index if not exists profiles_org_admin_idx on public.profiles(organization_id, admin_scope);

alter table public.organizations enable row level security;

-- ---------------------------------------------------------------------
-- Org/admin helpers
-- ---------------------------------------------------------------------

create or replace function public.current_organization_id(p_user_id uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = p_user_id;
$$;

create or replace function public.admin_scope_for(p_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select admin_scope from public.profiles where id = p_user_id), 'none');
$$;

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_scope_for(p_user_id) = 'platform';
$$;

create or replace function public.is_org_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_scope_for(p_user_id) in ('org', 'platform');
$$;

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select admin_scope in ('org', 'platform') or is_admin
    from public.profiles
    where id = p_user_id
  ), false);
$$;

create or replace function public.can_manage_profile(p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.is_platform_admin(auth.uid()) then true
    when public.admin_scope_for(auth.uid()) = 'org' then
      public.current_organization_id(auth.uid()) = public.current_organization_id(p_target_id)
    else false
  end;
$$;

create or replace function public.redacted_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when trim(coalesce(p_name, '')) = '' then ''
    when position(' ' in trim(p_name)) = 0 then trim(p_name)
    else split_part(trim(p_name), ' ', 1) || ' ' || left(split_part(trim(p_name), ' ', 2), 1) || '.'
  end;
$$;

create or replace function public.guard_profile_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.is_admin is distinct from old.is_admin
     or new.admin_scope is distinct from old.admin_scope
     or new.organization_id is distinct from old.organization_id
     or new.manager_id is distinct from old.manager_id
     or new.deactivated_at is distinct from old.deactivated_at then
    raise exception 'protected_columns: only service_role or admin RPCs can change admin/org columns, manager_id, or deactivated_at';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false);
  v_org_id uuid := coalesce(
    nullif(new.raw_user_meta_data->>'organization_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );
begin
  insert into public.profiles (
    id, name, department, seniority, job_title, tenure_years, location,
    must_change_password, is_admin, admin_scope, organization_id, onboarding_complete
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'department', ''),
    coalesce(new.raw_user_meta_data->>'seniority', 'junior'),
    coalesce(new.raw_user_meta_data->>'job_title', ''),
    coalesce((new.raw_user_meta_data->>'tenure_years')::int, 0),
    coalesce(new.raw_user_meta_data->>'location', ''),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false),
    v_is_admin,
    case when v_is_admin then 'platform' else 'none' end,
    v_org_id,
    coalesce((new.raw_user_meta_data->>'onboarding_complete')::boolean, v_is_admin)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Privacy-safe profile and counts
-- ---------------------------------------------------------------------

create or replace function public.direct_report_count(p_manager_id uuid default auth.uid())
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target_org uuid;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  select organization_id into v_target_org from public.profiles where id = p_manager_id;
  if p_manager_id <> v_caller and not public.can_manage_profile(p_manager_id) then
    raise exception 'forbidden';
  end if;
  return (
    select count(*)::int
    from public.profiles
    where manager_id = p_manager_id
      and organization_id = v_target_org
      and admin_scope = 'none'
      and deactivated_at is null
  );
end;
$$;

create or replace function public.skill_progress_for(p_user_id uuid)
returns table (
  id bigint,
  skill text,
  type text,
  example_project text,
  session_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.skill, s.type, s.example_project,
    case when s.type = 'can_teach' then (
      select count(*) from public.sessions sess
      where sess.mentor_id = s.user_id
        and sess.status = 'completed'
        and exists (
          select 1 from public.skills s2
          where s2.user_id = sess.mentee_id
            and s2.type = 'wants_to_learn'
            and lower(trim(s2.skill)) = lower(trim(s.skill))
        )
    ) else (
      select count(*) from public.sessions sess
      where sess.mentee_id = s.user_id
        and sess.status = 'completed'
        and exists (
          select 1 from public.skills s2
          where s2.user_id = sess.mentor_id
            and s2.type = 'can_teach'
            and lower(trim(s2.skill)) = lower(trim(s.skill))
        )
    ) end as session_count
  from public.skills s
  join public.profiles p on p.id = s.user_id
  where s.user_id = p_user_id
    and p.deactivated_at is null
    and (
      p_user_id = auth.uid()
      or (
        s.type = 'can_teach'
        and (p.organization_id = public.current_organization_id(auth.uid()) or public.is_platform_admin(auth.uid()))
      )
    );
$$;

create or replace function public.peer_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_viewer_org uuid;
  v_target public.profiles;
  v_skills jsonb;
  v_progress jsonb;
  v_badges jsonb;
  v_signature jsonb;
begin
  if v_viewer is null then raise exception 'auth_required'; end if;
  select organization_id into v_viewer_org from public.profiles where id = v_viewer;
  select * into v_target from public.profiles where id = p_user_id;
  if v_target.id is null or v_target.deactivated_at is not null then raise exception 'not_found'; end if;
  if v_target.organization_id <> v_viewer_org and not public.is_platform_admin(v_viewer) then
    raise exception 'not_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'user_id', user_id,
    'skill', skill,
    'type', type,
    'example_project', example_project
  ) order by lower(skill)), '[]'::jsonb)
  into v_skills
  from public.skills
  where user_id = p_user_id and type = 'can_teach';

  select coalesce(jsonb_agg(to_jsonb(sp) order by lower(sp.skill)), '[]'::jsonb)
  into v_progress
  from public.skill_progress_for(p_user_id) sp
  where sp.type = 'can_teach';

  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
  into v_badges
  from public.badges_for(p_user_id) b;

  select coalesce(jsonb_agg(skill order by skill), '[]'::jsonb)
  into v_signature
  from public.expertise_signature_for(p_user_id);

  return jsonb_build_object(
    'id', v_target.id,
    'name', public.redacted_name(v_target.name),
    'department', v_target.department,
    'seniority', v_target.seniority,
    'job_title', v_target.job_title,
    'current_role', v_target.job_title,
    'location', v_target.location,
    'bio', v_target.bio,
    'skills', v_skills,
    'skillProgress', v_progress,
    'expertiseSignature', v_signature,
    'badges', v_badges,
    'career', '[]'::jsonb,
    'direct_reports', 0,
    'is_admin', false
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Session lifecycle scoping
-- ---------------------------------------------------------------------

create or replace function public.request_session(
  p_mentor_id uuid,
  p_title text,
  p_scheduled_at timestamptz default null,
  p_duration_minutes int default 60,
  p_pre_session_question text default '',
  p_topics jsonb default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_org uuid;
  v_mentor public.profiles;
  v_topics jsonb;
  v_session public.sessions;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if v_caller = p_mentor_id then raise exception 'cannot_book_self'; end if;

  select organization_id into v_caller_org from public.profiles where id = v_caller;
  select * into v_mentor from public.profiles where id = p_mentor_id;
  if v_mentor.id is null then raise exception 'mentor_not_found'; end if;
  if v_mentor.deactivated_at is not null then raise exception 'mentor_deactivated'; end if;
  if v_mentor.organization_id <> v_caller_org then raise exception 'mentor_not_found'; end if;

  if exists (
    select 1 from public.sessions s
    where s.status in ('pending', 'scheduled')
      and ((s.mentor_id = p_mentor_id and s.mentee_id = v_caller)
        or (s.mentor_id = v_caller and s.mentee_id = p_mentor_id))
  ) then
    raise exception 'active_session_exists';
  end if;

  if p_topics is not null and jsonb_typeof(p_topics) = 'array' and jsonb_array_length(p_topics) > 0 then
    select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
    into v_topics
    from (
      select jsonb_array_elements_text(p_topics) as t
    ) x
    where exists (
      select 1 from public.skills s
      where s.user_id = p_mentor_id and s.type = 'can_teach'
        and lower(trim(s.skill)) = lower(trim(x.t))
    )
    limit 6;
    if jsonb_array_length(v_topics) = 0 then
      v_topics := public.compute_session_topics(p_mentor_id, v_caller);
    end if;
  else
    v_topics := public.compute_session_topics(p_mentor_id, v_caller);
  end if;

  insert into public.sessions
    (mentor_id, mentee_id, title, scheduled_at, duration_minutes, pre_session_question, topics, status)
  values
    (p_mentor_id, v_caller, p_title, p_scheduled_at, coalesce(p_duration_minutes, 60),
     coalesce(p_pre_session_question, ''), v_topics, 'pending')
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.session_payload(p_session public.sessions, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'mentor_id', p_session.mentor_id,
    'mentee_id', p_session.mentee_id,
    'connection_id', p_session.connection_id,
    'title', p_session.title,
    'scheduled_at', p_session.scheduled_at,
    'duration_minutes', p_session.duration_minutes,
    'status', p_session.status,
    'pre_session_question', p_session.pre_session_question,
    'reflection', case when p_session.mentee_id = p_viewer then p_session.reflection else '' end,
    'mentor_reflection', case when p_session.mentor_id = p_viewer then p_session.mentor_reflection else '' end,
    'mentee_rating', case when p_session.mentee_id = p_viewer then p_session.mentee_rating else null end,
    'mentor_rating', case when p_session.mentor_id = p_viewer then p_session.mentor_rating else null end,
    'mentee_completed_at', p_session.mentee_completed_at,
    'mentor_completed_at', p_session.mentor_completed_at,
    'topics', p_session.topics,
    'created_at', p_session.created_at
  );
$$;

create or replace function public.my_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(public.session_payload(s, v_caller) order by s.created_at desc)
    from public.sessions s
    where v_caller in (s.mentor_id, s.mentee_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.my_session(p_session_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  select * into v_session from public.sessions where id = p_session_id;
  if v_session.id is null or v_caller not in (v_session.mentor_id, v_session.mentee_id) then
    raise exception 'not_found';
  end if;
  return public.session_payload(v_session, v_caller);
end;
$$;

-- ---------------------------------------------------------------------
-- Matching: same org, no active request duplicates, optional directory fill.
-- ---------------------------------------------------------------------

drop function if exists public.get_matches_for(text, int, int);

create or replace function public.get_matches_for(
  p_role text default null,
  p_limit int default null,
  p_offset int default 0,
  p_include_directory boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_viewer_org uuid;
  v_dismissed uuid[];
  v_seen uuid[] := '{}';
  v_results jsonb := '[]'::jsonb;
  r record;
  v_other_id uuid;
  v_other public.profiles;
  v_skills jsonb;
  v_adjustment int;
  v_extra_reasons jsonb;
  v_accepts_count int;
  v_declines_count int;
  v_rating_avg numeric;
  v_rating_count int;
  v_dept_boost int;
  v_dept_penalty int;
  v_rating_adjust int;
  v_rating_reason text;
  v_total int := 0;
begin
  if v_viewer is null then raise exception 'auth_required'; end if;
  select organization_id into v_viewer_org from public.profiles where id = v_viewer;

  select coalesce(array_agg(addressee_id), '{}') into v_dismissed
  from public.connections
  where requester_id = v_viewer and status = 'declined';

  for r in
    select ms.*, case when ms.user_a_id = v_viewer then ms.user_b_id else ms.user_a_id end as other_id
    from public.match_scores ms
    where (ms.user_a_id = v_viewer or ms.user_b_id = v_viewer)
  loop
    v_other_id := r.other_id;
    if v_other_id = any(v_seen) then continue; end if;
    if v_other_id = any(v_dismissed) then continue; end if;
    if exists (
      select 1 from public.sessions s
      where s.status in ('pending', 'scheduled')
        and ((s.mentor_id = v_viewer and s.mentee_id = v_other_id)
          or (s.mentor_id = v_other_id and s.mentee_id = v_viewer))
    ) then continue; end if;
    if p_role = 'mentor' and not public.is_mentor_leaning(r.reasons, v_viewer, v_other_id) then continue; end if;

    select * into v_other from public.profiles where id = v_other_id;
    if v_other.id is null or v_other.deactivated_at is not null then continue; end if;
    if v_other.organization_id <> v_viewer_org then continue; end if;
    if v_other.admin_scope <> 'none' then continue; end if;

    select count(*),
           avg(case when s.mentor_id = v_viewer then s.mentor_rating else s.mentee_rating end)
    into v_rating_count, v_rating_avg
    from public.sessions s
    join public.profiles p on p.id = case when s.mentor_id = v_viewer then s.mentee_id else s.mentor_id end
    where (s.mentor_id = v_viewer or s.mentee_id = v_viewer)
      and s.status = 'completed'
      and p.department = v_other.department
      and (case when s.mentor_id = v_viewer then s.mentor_rating else s.mentee_rating end) is not null;

    v_rating_adjust := 0;
    v_rating_reason := null;
    if v_rating_count >= 2 then
      if v_rating_avg >= 4.5 then
        v_rating_adjust := 5;
        v_rating_reason := format('Your past sessions with %s colleagues have been consistently excellent — strong extra weight.', v_other.department);
      elsif v_rating_avg >= 4.0 then
        v_rating_adjust := 3;
        v_rating_reason := format('Your past ratings of %s sessions skew positive — extra weight added.', v_other.department);
      elsif v_rating_avg >= 3.5 then
        v_rating_adjust := 1;
      elsif v_rating_avg < 2.5 then
        v_rating_adjust := -5;
      elsif v_rating_avg < 3.0 then
        v_rating_adjust := -3;
      end if;
    end if;

    select count(*) into v_accepts_count
    from public.sessions s
    join public.profiles p on p.id = case when s.mentor_id = v_viewer then s.mentee_id else s.mentor_id end
    where (s.mentor_id = v_viewer or s.mentee_id = v_viewer)
      and s.status in ('scheduled','completed')
      and p.department = v_other.department;

    select count(*) into v_declines_count
    from public.connections c
    join public.profiles p on p.id = c.addressee_id
    where c.requester_id = v_viewer and c.status = 'declined' and p.department = v_other.department;

    v_dept_boost := least(v_accepts_count * 2, 6);
    v_dept_penalty := -least(v_declines_count, 8);
    v_adjustment := v_dept_boost + v_dept_penalty + v_rating_adjust;

    v_extra_reasons := '[]'::jsonb;
    if v_rating_reason is not null then
      v_extra_reasons := v_extra_reasons || to_jsonb(v_rating_reason);
    elsif v_accepts_count >= 1 then
      v_extra_reasons := v_extra_reasons || to_jsonb(format(
        'Past mentoring with %s colleagues has gone well — extra weight added.', v_other.department
      ));
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('skill', skill, 'type', type, 'example_project', example_project)), '[]'::jsonb)
    into v_skills
    from public.skills where user_id = v_other_id and type = 'can_teach';

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'matchId', r.id,
      'baseScore', r.score,
      'adjustment', v_adjustment,
      'score', greatest(0, least(100, r.score + v_adjustment)),
      'structuredReasons', r.reasons,
      'extraReasons', v_extra_reasons,
      'user', jsonb_build_object(
        'id', v_other.id,
        'name', public.redacted_name(v_other.name),
        'department', v_other.department,
        'seniority', v_other.seniority,
        'job_title', v_other.job_title,
        'location', v_other.location,
        'bio', v_other.bio,
        'skills', v_skills
      )
    ));
    v_seen := array_append(v_seen, v_other_id);
  end loop;

  if p_include_directory then
    for v_other in
      select *
      from public.profiles
      where organization_id = v_viewer_org
        and id <> v_viewer
        and admin_scope = 'none'
        and onboarding_complete
        and deactivated_at is null
      order by lower(name)
      limit 100
    loop
      if v_other.id = any(v_seen) then continue; end if;
      if v_other.id = any(v_dismissed) then continue; end if;
      if exists (
        select 1 from public.sessions s
        where s.status in ('pending', 'scheduled')
          and ((s.mentor_id = v_viewer and s.mentee_id = v_other.id)
            or (s.mentor_id = v_other.id and s.mentee_id = v_viewer))
      ) then continue; end if;

      select coalesce(jsonb_agg(jsonb_build_object('skill', skill, 'type', type, 'example_project', example_project)), '[]'::jsonb)
      into v_skills
      from public.skills where user_id = v_other.id and type = 'can_teach';

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'matchId', 'directory-' || v_other.id::text,
        'baseScore', 0,
        'adjustment', 0,
        'score', 0,
        'structuredReasons', '[]'::jsonb,
        'extraReasons', '[]'::jsonb,
        'user', jsonb_build_object(
          'id', v_other.id,
          'name', public.redacted_name(v_other.name),
          'department', v_other.department,
          'seniority', v_other.seniority,
          'job_title', v_other.job_title,
          'location', v_other.location,
          'bio', v_other.bio,
          'skills', v_skills
        )
      ));
      v_seen := array_append(v_seen, v_other.id);
    end loop;
  end if;

  with arr as (
    select jsonb_array_elements(v_results) as m
  ),
  sorted as (
    select m,
           coalesce((m->>'score')::int, 0) as s,
           lower(coalesce(m->'user'->>'name', '')) as n
    from arr
    order by s desc, n asc
  )
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_results from sorted;

  v_total := jsonb_array_length(v_results);

  if p_limit is not null then
    select coalesce(jsonb_agg(m order by idx), '[]'::jsonb)
    into v_results
    from (
      select m, (row_number() over () - 1) as idx
      from (select jsonb_array_elements(v_results) as m) z
    ) zz
    where idx >= p_offset and idx < p_offset + p_limit;
  end if;

  return jsonb_build_object('matches', v_results, 'total', v_total);
end;
$$;

create or replace function public.recompute_matches_for(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_other public.profiles;
  v_a uuid;
  v_b uuid;
  v_score int;
  v_reasons jsonb;
  v_count int := 0;
  v_a_teaches text[];
  v_a_learns text[];
  v_b_teaches text[];
  v_b_learns text[];
  v_a_career_depts text[];
  v_b_career_depts text[];
  v_b_teach_a_learn text[];
  v_a_teach_b_learn text[];
  v_skill_count int;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id and not public.is_admin(auth.uid()) then
    raise exception 'forbidden';
  end if;

  select * into v_target from public.profiles where id = p_user_id and admin_scope = 'none';
  if v_target.id is null then return 0; end if;

  delete from public.match_scores where user_a_id = p_user_id or user_b_id = p_user_id;

  for v_other in
    select * from public.profiles
    where admin_scope = 'none'
      and id <> p_user_id
      and organization_id = v_target.organization_id
      and deactivated_at is null
  loop
    v_score := 0;
    v_reasons := '[]'::jsonb;

    if p_user_id < v_other.id then
      v_a := p_user_id; v_b := v_other.id;
    else
      v_a := v_other.id; v_b := p_user_id;
    end if;

    select array_agg(distinct lower(trim(skill))) filter (where type = 'can_teach'),
           array_agg(distinct lower(trim(skill))) filter (where type = 'wants_to_learn')
      into v_a_teaches, v_a_learns
    from public.skills where user_id = v_a;
    select array_agg(distinct lower(trim(skill))) filter (where type = 'can_teach'),
           array_agg(distinct lower(trim(skill))) filter (where type = 'wants_to_learn')
      into v_b_teaches, v_b_learns
    from public.skills where user_id = v_b;

    v_a_teaches := coalesce(v_a_teaches, '{}');
    v_a_learns := coalesce(v_a_learns, '{}');
    v_b_teaches := coalesce(v_b_teaches, '{}');
    v_b_learns := coalesce(v_b_learns, '{}');

    select array(select unnest(v_a_learns) intersect select unnest(v_b_teaches)) into v_b_teach_a_learn;
    select array(select unnest(v_b_learns) intersect select unnest(v_a_teaches)) into v_a_teach_b_learn;

    v_skill_count := coalesce(array_length(
      array(select unnest(v_b_teach_a_learn) union select unnest(v_a_teach_b_learn)), 1
    ), 0);
    v_score := v_score + least(v_skill_count * 10, 40);

    if array_length(v_b_teach_a_learn, 1) > 0 then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'type', 'teach_overlap',
        'teacher_id', v_b,
        'learner_id', v_a,
        'skills', to_jsonb(v_b_teach_a_learn[1:3])
      ));
    end if;
    if array_length(v_a_teach_b_learn, 1) > 0 then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'type', 'teach_overlap',
        'teacher_id', v_a,
        'learner_id', v_b,
        'skills', to_jsonb(v_a_teach_b_learn[1:3])
      ));
    end if;

    select array_agg(department) into v_a_career_depts from public.career_history where user_id = v_a;
    select array_agg(department) into v_b_career_depts from public.career_history where user_id = v_b;
    v_a_career_depts := coalesce(v_a_career_depts, '{}');
    v_b_career_depts := coalesce(v_b_career_depts, '{}');

    if (select (select department from public.profiles where id = v_a) = any(v_b_career_depts)) then
      v_score := v_score + 20;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'type', 'career_bridge', 'who_id', v_b,
        'into_dept', (select department from public.profiles where id = v_a)
      ));
    elsif (select (select department from public.profiles where id = v_b) = any(v_a_career_depts)) then
      v_score := v_score + 20;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'type', 'career_bridge', 'who_id', v_a,
        'into_dept', (select department from public.profiles where id = v_b)
      ));
    end if;

    if (select p1.department <> p2.department from public.profiles p1, public.profiles p2 where p1.id = v_a and p2.id = v_b) then
      v_score := v_score + 25;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'type', 'dept_diversity',
        'a_id', v_a, 'a_dept', (select department from public.profiles where id = v_a),
        'b_id', v_b, 'b_dept', (select department from public.profiles where id = v_b)
      ));
    end if;

    if v_score >= 30 then
      insert into public.match_scores (user_a_id, user_b_id, score, reasons, computed_at)
      values (v_a, v_b, v_score, v_reasons, now())
      on conflict (user_a_id, user_b_id)
      do update set score = excluded.score, reasons = excluded.reasons, computed_at = excluded.computed_at;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.recompute_all_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_total int := 0;
begin
  delete from public.match_scores;
  for v_user in select id from public.profiles where admin_scope = 'none' loop
    perform public.recompute_matches_for(v_user.id);
  end loop;
  select count(*) into v_total from public.match_scores;
  return v_total;
end;
$$;

create or replace function public.admin_recompute_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
  v_count int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  perform public.recompute_all_matches();
  select count(*)::int into v_count
  from public.match_scores ms
  join public.profiles a on a.id = ms.user_a_id
  join public.profiles b on b.id = ms.user_b_id
  where v_platform or (a.organization_id = v_org and b.organization_id = v_org);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin and owner reporting, scoped by org unless platform admin.
-- ---------------------------------------------------------------------

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return jsonb_build_object(
    'totalUsers', (
      select count(*) from public.profiles
      where admin_scope = 'none' and deactivated_at is null
        and (v_platform or organization_id = v_org)
    ),
    'onboarded', (
      select count(*) from public.profiles
      where admin_scope = 'none' and onboarding_complete and deactivated_at is null
        and (v_platform or organization_id = v_org)
    ),
    'onboardingRate', (
      select case when count(*) = 0 then 0
        else round(count(*) filter (where onboarding_complete) * 100.0 / count(*))
      end
      from public.profiles
      where admin_scope = 'none' and deactivated_at is null
        and (v_platform or organization_id = v_org)
    ),
    'totalMatches', (
      select count(*)
      from public.match_scores ms
      join public.profiles a on a.id = ms.user_a_id
      join public.profiles b on b.id = ms.user_b_id
      where v_platform or (a.organization_id = v_org and b.organization_id = v_org)
    ),
    'sessionsByStatus', coalesce(
      (select jsonb_agg(jsonb_build_object('status', status, 'cnt', cnt))
       from (
         select s.status, count(*)::int as cnt
         from public.sessions s
         join public.profiles m on m.id = s.mentor_id
         where v_platform or m.organization_id = v_org
         group by s.status
       ) s),
      '[]'::jsonb
    ),
    'topMentors', coalesce(
      (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department, 'seniority', seniority, 'session_count', session_count))
       from (
         select p.id, p.name, p.department, p.seniority, count(s.id)::int as session_count
         from public.profiles p
         join public.sessions s on s.mentor_id = p.id and s.status = 'completed'
         where p.deactivated_at is null
           and (v_platform or p.organization_id = v_org)
         group by p.id
         order by session_count desc
         limit 5
       ) m),
      '[]'::jsonb
    ),
    'deptActivity', coalesce(
      (select jsonb_agg(jsonb_build_object('department', department, 'session_count', session_count))
       from (
         select p.department, count(distinct s.id)::int as session_count
         from public.profiles p
         left join public.sessions s on (s.mentor_id = p.id or s.mentee_id = p.id) and s.status = 'completed'
         where p.admin_scope = 'none' and p.deactivated_at is null
           and (v_platform or p.organization_id = v_org)
         group by p.department
         order by session_count asc
       ) d),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.admin_users(p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
  v_users jsonb;
  v_total int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  select count(*) into v_total
  from public.profiles
  where admin_scope = 'none'
    and (v_platform or organization_id = v_org);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'email', email,
    'name', name,
    'department', department,
    'job_title', job_title,
    'onboarding_complete', onboarding_complete,
    'deactivated_at', deactivated_at,
    'must_change_password', must_change_password,
    'manager_email', manager_email
  ) order by name), '[]'::jsonb)
  into v_users
  from (
    select
      u.id,
      au.email,
      u.name,
      u.department,
      u.job_title,
      u.onboarding_complete,
      u.deactivated_at,
      u.must_change_password,
      m_au.email as manager_email
    from public.profiles u
    join auth.users au on au.id = u.id
    left join public.profiles m on m.id = u.manager_id
    left join auth.users m_au on m_au.id = m.id
    where u.admin_scope = 'none'
      and (v_platform or u.organization_id = v_org)
    order by u.name
    limit p_limit offset p_offset
  ) q;

  return jsonb_build_object('users', v_users, 'total', v_total);
end;
$$;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target public.profiles;
  v_email text;
  v_manager_email text;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if not public.can_manage_profile(p_user_id) then raise exception 'not_found'; end if;
  select * into v_target from public.profiles where id = p_user_id and admin_scope = 'none';
  if v_target.id is null then raise exception 'not_found'; end if;
  select email into v_email from auth.users where id = p_user_id;
  select au.email into v_manager_email
  from public.profiles m
  join auth.users au on au.id = m.id
  where m.id = v_target.manager_id;
  return jsonb_build_object('user', to_jsonb(v_target) || jsonb_build_object(
    'email', v_email,
    'manager_email', v_manager_email,
    'current_role', v_target.job_title
  ));
end;
$$;

create or replace function public.admin_audit(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return jsonb_build_object(
    'total', (
      select count(*)
      from public.audit_logs a
      left join public.profiles p on p.id = a.actor_id
      where v_platform or p.organization_id = v_org
    ),
    'entries', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'target_type', a.target_type,
        'target_id', a.target_id,
        'metadata', a.metadata,
        'ip', a.ip,
        'created_at', a.created_at,
        'actor', case when au.id is not null then jsonb_build_object('email', au.email, 'name', p.name) else null end
      ) order by a.id desc)
      from (
        select a.*
        from public.audit_logs a
        left join public.profiles p on p.id = a.actor_id
        where v_platform or p.organization_id = v_org
        order by a.id desc
        limit p_limit
      ) a
      left join auth.users au on au.id = a.actor_id
      left join public.profiles p on p.id = a.actor_id),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.admin_set_manager(p_user_id uuid, p_manager_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target_org uuid := public.current_organization_id(p_user_id);
  v_mgr_id uuid;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if p_user_id = v_caller then raise exception 'cannot_set_self'; end if;
  if not public.can_manage_profile(p_user_id) then raise exception 'forbidden'; end if;

  if p_manager_email is null or trim(p_manager_email) = '' then
    update public.profiles set manager_id = null where id = p_user_id and public.can_manage_profile(id);
    return;
  end if;

  select au.id into v_mgr_id
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(au.email) = lower(trim(p_manager_email))
    and p.deactivated_at is null
    and p.organization_id = v_target_org;
  if v_mgr_id is null then raise exception 'manager_not_found'; end if;
  if v_mgr_id = p_user_id then raise exception 'cannot_self_manage'; end if;

  update public.profiles set manager_id = v_mgr_id where id = p_user_id and public.can_manage_profile(id);
end;
$$;

create or replace function public.admin_deactivate(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if p_user_id = v_caller then raise exception 'cannot_deactivate_self'; end if;
  if not public.can_manage_profile(p_user_id) then raise exception 'forbidden'; end if;
  update public.profiles set deactivated_at = now()
  where id = p_user_id and admin_scope = 'none';
end;
$$;

create or replace function public.admin_broadcast_checkin()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid := public.current_organization_id(auth.uid());
  v_platform boolean := public.is_platform_admin(auth.uid());
  v_count int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  update public.profiles
  set pending_checkin = true
  where admin_scope = 'none'
    and deactivated_at is null
    and (v_platform or organization_id = v_org);
  get diagnostics v_count = row_count;
  insert into public.audit_logs (actor_id, action, metadata)
  values (v_caller, 'admin.broadcast_checkin', jsonb_build_object('recipients', v_count));
  return v_count;
end;
$$;

create or replace function public.platform_owner_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_platform_admin(v_caller) then raise exception 'platform_admin_only'; end if;

  return jsonb_build_object(
    'organizations', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'organizationId', o.id,
        'organizationName', o.name,
        'slug', o.slug,
        'totalUsers', (select count(*) from public.profiles p where p.organization_id = o.id and p.admin_scope = 'none' and p.deactivated_at is null),
        'onboarded', (select count(*) from public.profiles p where p.organization_id = o.id and p.admin_scope = 'none' and p.onboarding_complete and p.deactivated_at is null),
        'onboardingRate', (
          select case when count(*) = 0 then 0 else round(count(*) filter (where p.onboarding_complete) * 100.0 / count(*)) end
          from public.profiles p
          where p.organization_id = o.id and p.admin_scope = 'none' and p.deactivated_at is null
        ),
        'activeMembers', (
          select count(*)
          from public.profiles p
          join auth.users au on au.id = p.id
          where p.organization_id = o.id
            and p.admin_scope = 'none'
            and p.deactivated_at is null
            and au.last_sign_in_at >= now() - interval '30 days'
        ),
        'sessions', (
          select count(*)
          from public.sessions s
          join public.profiles p on p.id = s.mentor_id
          where p.organization_id = o.id
        ),
        'churned', (
          select count(*)
          from public.profiles p
          where p.organization_id = o.id and p.admin_scope = 'none' and p.deactivated_at is not null
        )
      ) order by o.name)
      from public.organizations o),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.team_skill_gaps(p_manager_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_min_for_report constant int := 3;
  v_reports uuid[];
  v_count int;
  v_gaps jsonb;
  v_strengths jsonb;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_manager_id <> v_caller and not public.can_manage_profile(p_manager_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(array_agg(id), '{}') into v_reports
  from public.profiles
  where manager_id = p_manager_id and admin_scope = 'none' and deactivated_at is null
    and organization_id = public.current_organization_id(p_manager_id);

  v_count := coalesce(array_length(v_reports, 1), 0);

  if v_count = 0 then
    return jsonb_build_object(
      'reportCount', 0, 'gated', false,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', 'You have no direct reports linked in MENT.'
    );
  end if;

  if v_count < v_min_for_report then
    return jsonb_build_object(
      'reportCount', v_count, 'gated', true,
      'minRequired', v_min_for_report,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', format(
        'Reports are anonymized — you need at least %s direct reports for a meaningful, de-identified picture. You currently have %s.',
        v_min_for_report, v_count
      )
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('skill', skill, 'count', cnt, 'share', round(cnt * 100.0 / v_count)) order by cnt desc, skill), '[]'::jsonb)
  into v_gaps
  from (
    select lower(trim(skill)) as skill, count(distinct user_id)::int as cnt
    from public.skills
    where user_id = any(v_reports) and type = 'wants_to_learn'
    group by lower(trim(skill))
    order by cnt desc, skill
    limit 10
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('skill', skill, 'count', cnt, 'share', round(cnt * 100.0 / v_count)) order by cnt desc, skill), '[]'::jsonb)
  into v_strengths
  from (
    select lower(trim(skill)) as skill, count(distinct user_id)::int as cnt
    from public.skills
    where user_id = any(v_reports) and type = 'can_teach'
    group by lower(trim(skill))
    order by cnt desc, skill
    limit 10
  ) s;

  return jsonb_build_object(
    'reportCount', v_count,
    'gated', false,
    'gaps', v_gaps,
    'strengths', v_strengths,
    'message', null
  );
end;
$$;

-- ---------------------------------------------------------------------
-- RLS: raw tables are self-only; directory/admin access is through RPCs.
-- ---------------------------------------------------------------------

drop policy if exists orgs_select_own on public.organizations;
create policy orgs_select_own on public.organizations
  for select to authenticated
  using (id = public.current_organization_id(auth.uid()) or public.is_platform_admin(auth.uid()));

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists skills_select on public.skills;
drop policy if exists skills_select_own on public.skills;
create policy skills_select_own on public.skills
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists career_select on public.career_history;
drop policy if exists career_select_own on public.career_history;
create policy career_select_own on public.career_history
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists sessions_select on public.sessions;

drop policy if exists imports_admin on storage.objects;
create policy imports_admin on storage.objects
  for all to authenticated
  using (
    bucket_id = 'imports'
    and public.is_admin(auth.uid())
    and (public.is_platform_admin(auth.uid()) or (storage.foldername(name))[1] = auth.uid()::text)
  )
  with check (
    bucket_id = 'imports'
    and public.is_admin(auth.uid())
    and (public.is_platform_admin(auth.uid()) or (storage.foldername(name))[1] = auth.uid()::text)
  );

revoke all on function
  public.current_organization_id(uuid),
  public.admin_scope_for(uuid),
  public.is_platform_admin(uuid),
  public.is_org_admin(uuid),
  public.can_manage_profile(uuid),
  public.redacted_name(text),
  public.direct_report_count(uuid),
  public.peer_profile(uuid),
  public.request_session(uuid, text, timestamptz, int, text, jsonb),
  public.session_payload(public.sessions, uuid),
  public.my_sessions(),
  public.my_session(bigint),
  public.get_matches_for(text, int, int, boolean),
  public.recompute_matches_for(uuid),
  public.recompute_all_matches(),
  public.admin_stats(),
  public.admin_users(int, int),
  public.admin_user_detail(uuid),
  public.admin_audit(int),
  public.admin_recompute_matches(),
  public.admin_set_manager(uuid, text),
  public.admin_deactivate(uuid),
  public.admin_broadcast_checkin(),
  public.platform_owner_stats(),
  public.team_skill_gaps(uuid)
from public;

revoke all on function public.recompute_all_matches() from authenticated;

grant execute on function
  public.current_organization_id(uuid),
  public.admin_scope_for(uuid),
  public.is_platform_admin(uuid),
  public.is_org_admin(uuid),
  public.can_manage_profile(uuid),
  public.redacted_name(text),
  public.direct_report_count(uuid),
  public.peer_profile(uuid),
  public.request_session(uuid, text, timestamptz, int, text, jsonb),
  public.my_sessions(),
  public.my_session(bigint),
  public.get_matches_for(text, int, int, boolean),
  public.admin_stats(),
  public.admin_users(int, int),
  public.admin_user_detail(uuid),
  public.admin_audit(int),
  public.admin_recompute_matches(),
  public.admin_set_manager(uuid, text),
  public.admin_deactivate(uuid),
  public.admin_broadcast_checkin(),
  public.platform_owner_stats(),
  public.team_skill_gaps(uuid)
to authenticated;

grant execute on function
  public.recompute_matches_for(uuid)
to authenticated;
