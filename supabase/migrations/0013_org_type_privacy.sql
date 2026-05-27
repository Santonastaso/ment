-- Multi-tenant privacy posture per organization.
--
-- Per FRA's feedback: when we ship the cross-company ("inter") version for
-- SMBs we need stricter defaults than the original intra-company MVP:
--   * surname should NOT be public by default (first name only)
--   * the employer company name should NOT be public by default
--   * the team dashboard should only appear once there are enough people
--     in the org to keep aggregate counts from de-anonymising individuals.
--
-- This migration introduces `organizations.type` (intra | inter) and a
-- configurable `min_team_dashboard_size`, then updates the redaction layer
-- (peer_profile, get_matches_for) to honour the type. Intra (current behaviour)
-- stays exactly the same; inter applies the extra redactions.

alter table public.organizations
  add column if not exists type text not null default 'intra'
    check (type in ('intra', 'inter')),
  add column if not exists min_team_dashboard_size integer not null default 3
    check (min_team_dashboard_size >= 1 and min_team_dashboard_size <= 100);

-- Backfill: the seed demo org stays intra.
update public.organizations set type = coalesce(type, 'intra') where id is not null;

-- A small helper so RPCs can short-circuit on org type without a full
-- profiles join.
create or replace function public.org_type_for(p_user_id uuid default auth.uid())
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(o.type, 'intra')
  from public.profiles p
  left join public.organizations o on o.id = p.organization_id
  where p.id = p_user_id
$$;

grant execute on function public.org_type_for(uuid) to authenticated;

-- Stricter redaction when the viewer is in an inter-company org. We
-- redact surname (first name + last initial → already covered by
-- redacted_name) but ALSO strip job_title and any company-identifying
-- text. peer_profile shape stays identical, individual fields are blanked.

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
  v_org_type text;
  v_inter boolean;
begin
  if v_viewer is null then raise exception 'auth_required'; end if;
  select organization_id into v_viewer_org from public.profiles where id = v_viewer;
  select * into v_target from public.profiles where id = p_user_id;
  if v_target.id is null or v_target.deactivated_at is not null then raise exception 'not_found'; end if;
  if v_target.organization_id <> v_viewer_org and not public.is_platform_admin(v_viewer) then
    raise exception 'not_found';
  end if;

  select coalesce(o.type, 'intra') into v_org_type
  from public.organizations o where o.id = v_viewer_org;
  v_inter := v_org_type = 'inter';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'user_id', user_id, 'skill', skill, 'type', type, 'example_project', example_project
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
    -- Inter mode hides job_title (often reveals seniority + employer)
    'job_title', case when v_inter then null else v_target.job_title end,
    'current_role', case when v_inter then null else v_target.job_title end,
    -- Inter mode hides exact location (city granularity may identify the user)
    'location', case when v_inter then null else v_target.location end,
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
    'mentorship_available', v_available,
    'org_type', v_org_type
  );
end;
$$;

-- The team-skill-gaps RPC suppresses the report below 3 reports by default.
-- Inter-company orgs lift the threshold to organizations.min_team_dashboard_size
-- (which defaults to 3 but can be raised per-org).

create or replace function public.team_skill_gaps(p_manager_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_org_type text;
  v_min int := 3;
  v_count int;
  v_total int;
  v_gaps jsonb;
  v_strengths jsonb;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_manager_id is null then p_manager_id := v_caller; end if;
  if p_manager_id <> v_caller and not public.is_admin(v_caller) then
    raise exception 'forbidden';
  end if;

  select organization_id into v_org from public.profiles where id = p_manager_id;
  select coalesce(o.type, 'intra'), coalesce(o.min_team_dashboard_size, 3)
    into v_org_type, v_min
  from public.organizations o where o.id = v_org;
  -- inter orgs use the configured min (capped low end at 3 still)
  if v_org_type = 'inter' and v_min < 3 then v_min := 3; end if;

  select count(*) into v_count
  from public.profiles p
  where p.manager_id = p_manager_id
    and p.deactivated_at is null;

  if v_count = 0 then
    return jsonb_build_object(
      'reportCount', 0, 'gated', false,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', 'No direct reports linked. Set up reporting lines in Admin → Users to populate this dashboard.'
    );
  end if;

  if v_count < v_min then
    return jsonb_build_object(
      'reportCount', v_count, 'gated', true,
      'gaps', '[]'::jsonb, 'strengths', '[]'::jsonb,
      'message', format(
        'Suppressed: %s direct report%s. We hide the team report until you have at least %s reports so individual answers stay anonymous.',
        v_count, case when v_count = 1 then '' else 's' end, v_min
      )
    );
  end if;

  -- Aggregate counts of wants_to_learn (gaps) and can_teach (strengths)
  -- across the manager's direct reports.
  select v_count into v_total;

  with reports as (
    select id from public.profiles where manager_id = p_manager_id and deactivated_at is null
  ),
  buckets as (
    select s.skill, s.type, count(distinct s.user_id) as cnt
    from public.skills s
    join reports r on r.id = s.user_id
    group by s.skill, s.type
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object('skill', skill, 'count', cnt,
                         'share', round(cnt::numeric * 100 / v_total))
      order by cnt desc, lower(skill)
    ) filter (where type = 'wants_to_learn'), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('skill', skill, 'count', cnt,
                         'share', round(cnt::numeric * 100 / v_total))
      order by cnt desc, lower(skill)
    ) filter (where type = 'can_teach'), '[]'::jsonb)
  into v_gaps, v_strengths
  from buckets;

  return jsonb_build_object(
    'reportCount', v_count, 'gated', false,
    'gaps', coalesce(v_gaps, '[]'::jsonb),
    'strengths', coalesce(v_strengths, '[]'::jsonb),
    'orgType', v_org_type,
    'minTeamDashboardSize', v_min
  );
end;
$$;

grant execute on function public.team_skill_gaps(uuid) to authenticated;

-- Surface the org type in privacy_status so admins can see how their org is
-- currently configured.
create or replace function public.privacy_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_type text;
  v_min int;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if not public.is_admin(v_caller) then raise exception 'forbidden'; end if;
  select organization_id into v_org from public.profiles where id = v_caller;
  select coalesce(o.type, 'intra'), coalesce(o.min_team_dashboard_size, 3)
    into v_type, v_min
  from public.organizations o where o.id = v_org;

  return jsonb_build_object(
    -- Legacy keys consumed by AdminDashboard.jsx — keep stable
    'aiClassification', jsonb_build_object(
      'label', 'Off by default',
      'enabled', false,
      'source', 'AI_CLASSIFICATION_ENABLED must be explicitly true in Supabase Edge Function settings'
    ),
    'supabaseRegion', 'eu-central-1',
    'peerVisibleFields', jsonb_build_array(
      'first name + last initial', 'role', 'department', 'location', 'bio', 'teachable skills'
    ),
    'hiddenFields', jsonb_build_array(
      'reflections', 'ratings', 'wants-to-learn', 'shadow role',
      'shadow_role_response (column-locked)', 'session reflections/ratings (column-locked)'
    ),
    'edgeFunctions', jsonb_build_array(
      jsonb_build_object('name', 'admin-create-user', 'status', 'configured'),
      jsonb_build_object('name', 'admin-reset-password', 'status', 'configured'),
      jsonb_build_object('name', 'profile-ingest', 'status', 'configured'),
      jsonb_build_object('name', 'reflection-classify', 'status', 'configured')
    ),
    -- 0013 additions
    'orgType', v_type,
    'minTeamDashboardSize', v_min,
    'interExtraRedactions', case when v_type = 'inter'
      then jsonb_build_array('job_title','location')
      else '[]'::jsonb end
  );
end;
$$;

grant execute on function public.privacy_status() to authenticated;

-- Platform admins can switch their own org between intra/inter, and tune
-- the team-dashboard threshold. Org admins can tune the threshold inside
-- their own org but cannot change the type (cross-org/intra is a platform
-- decision).
create or replace function public.set_org_privacy(
  p_type text default null,
  p_min_team_dashboard_size integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_scope text;
  v_org uuid;
  v_row public.organizations;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  v_scope := public.admin_scope_for(v_caller);
  select organization_id into v_org from public.profiles where id = v_caller;
  if v_org is null then raise exception 'no_org'; end if;

  if p_type is not null then
    if v_scope <> 'platform' then raise exception 'platform_admin_only'; end if;
    if p_type not in ('intra', 'inter') then raise exception 'invalid_type'; end if;
    update public.organizations set type = p_type where id = v_org;
  end if;

  if p_min_team_dashboard_size is not null then
    if v_scope not in ('org', 'platform') then raise exception 'forbidden'; end if;
    if p_min_team_dashboard_size < 1 or p_min_team_dashboard_size > 100 then
      raise exception 'invalid_min_size';
    end if;
    update public.organizations set min_team_dashboard_size = p_min_team_dashboard_size where id = v_org;
  end if;

  select * into v_row from public.organizations where id = v_org;
  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'slug', v_row.slug,
    'type', v_row.type,
    'min_team_dashboard_size', v_row.min_team_dashboard_size
  );
end;
$$;

grant execute on function public.set_org_privacy(text, integer) to authenticated;

-- Extend the dashboard / explorer match cards with the same inter-mode
-- redaction we applied to peer_profile: blank out job_title and location.
-- We mirror the 0010 definition but apply the redaction inside the user
-- jsonb both in the scored-matches loop and in the directory-fill branch.

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
  v_org_type text;
  v_inter boolean;
begin
  if v_viewer is null then raise exception 'auth_required'; end if;
  select organization_id into v_viewer_org from public.profiles where id = v_viewer;
  select coalesce(o.type, 'intra') into v_org_type
    from public.organizations o where o.id = v_viewer_org;
  v_inter := v_org_type = 'inter';

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
        'job_title', case when v_inter then null else v_other.job_title end,
        'location', case when v_inter then null else v_other.location end,
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
          'job_title', case when v_inter then null else v_other.job_title end,
          'location', case when v_inter then null else v_other.location end,
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
