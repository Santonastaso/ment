-- Mentorship availability controls.
--
-- Lets a user temporarily stop accepting mentor requests without removing
-- their profile or skills. Two knobs:
--   * mentorship_paused           bool   — instantly toggleable (manual pause)
--   * mentorship_unavailable_until date — optional "back on YYYY-MM-DD"
-- The match-generation query treats either signal as "exclude as candidate."

alter table public.profiles
  add column if not exists mentorship_paused boolean not null default false,
  add column if not exists mentorship_unavailable_until date,
  add column if not exists mentorship_note text;

-- Restore the lean guard from 0006 (which 0010's earlier draft accidentally
-- replaced with a too-strict version). Service-role and trigger-depth>1
-- bypass; non-admin users are only blocked from changing admin/org columns.
-- The new mentorship_* fields are deliberately user-writable.
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

-- Mentor candidate filter: exclude paused users + users whose
-- unavailable_until is in the future. We embed this directly into
-- `get_matches_for` and the directory-fill branch by patching the SQL.

create or replace function public.is_currently_available_mentor(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    not p.mentorship_paused
    and (p.mentorship_unavailable_until is null
         or p.mentorship_unavailable_until <= current_date),
    true
  )
  from public.profiles p
  where p.id = p_user_id
$$;

grant execute on function public.is_currently_available_mentor(uuid) to authenticated;

-- Patch get_matches_for so paused mentors disappear from mentor suggestion
-- and directory-fill paths. This is a CREATE OR REPLACE that mirrors the
-- 0006 definition plus three new `continue` checks driven by
-- `is_currently_available_mentor`.

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
    -- New: paused mentors are hidden as mentor candidates.
    if p_role = 'mentor' and not public.is_currently_available_mentor(v_other_id) then continue; end if;

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
      -- New: hide paused mentors from directory-fill when the viewer is
      -- looking for a mentor specifically.
      if p_role = 'mentor' and not public.is_currently_available_mentor(v_other.id) then continue; end if;
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

  return jsonb_build_object('total', v_total, 'matches', v_results);
end;
$$;

grant execute on function public.get_matches_for(text, int, int, boolean) to authenticated;

-- Reject incoming session requests aimed at a paused mentor. We patch
-- request_session by reusing the existing definition from 0006 plus one
-- extra availability check upfront.

create or replace function public.request_session(
  p_mentor_id uuid,
  p_title text,
  p_scheduled_at timestamptz default null,
  p_duration_minutes int default 60,
  p_pre_session_question text default null,
  p_topics jsonb default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_mentor public.profiles;
  v_caller_org uuid;
  v_topics jsonb;
  v_session public.sessions;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_mentor_id is null then raise exception 'mentor_required'; end if;
  if p_mentor_id = v_caller then raise exception 'cannot_mentor_self'; end if;
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'title_required'; end if;

  select * into v_mentor from public.profiles where id = p_mentor_id;
  if v_mentor.id is null or v_mentor.deactivated_at is not null then
    raise exception 'mentor_not_available';
  end if;

  select organization_id into v_caller_org from public.profiles where id = v_caller;
  if v_caller_org is null or v_mentor.organization_id is null or v_caller_org <> v_mentor.organization_id then
    raise exception 'mentor_not_available';
  end if;

  -- New: refuse the request if the mentor is currently paused / OOO.
  if not public.is_currently_available_mentor(p_mentor_id) then
    raise exception 'mentor_paused';
  end if;

  v_topics := coalesce(p_topics, '[]'::jsonb);
  if jsonb_typeof(v_topics) <> 'array' then v_topics := '[]'::jsonb; end if;

  insert into public.sessions
    (mentor_id, mentee_id, title, scheduled_at, duration_minutes, pre_session_question, topics, status)
  values
    (p_mentor_id, v_caller, p_title, p_scheduled_at, coalesce(p_duration_minutes, 60),
     coalesce(p_pre_session_question, ''), v_topics, 'pending')
  returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.request_session(uuid, text, timestamptz, int, text, jsonb) to authenticated;

-- Surface mentorship availability through peer_profile so peer-facing
-- cards can show a "Currently unavailable" badge.
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
  v_available boolean;
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

  v_available := public.is_currently_available_mentor(p_user_id);

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
    'is_admin', false,
    'mentorship_paused', v_target.mentorship_paused,
    'mentorship_unavailable_until', v_target.mentorship_unavailable_until,
    'mentorship_available', v_available
  );
end;
$$;
