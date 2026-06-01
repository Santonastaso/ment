-- 0020 Privacy refinement (F1)
--
-- 1. Surname redaction (redacted_name) was applied to ALL org types. The PM
--    only wants surnames hidden in the cross-company "inter" (PMI/SME) pool;
--    single-employer "intra" orgs should show full names. Gate the name on
--    v_inter in peer_profile and get_matches_for (job_title/location were
--    already gated).
-- 2. Convert the English match "extra reasons" into structured tokens so the
--    client can localize them (P3). Shape: { type, dept }.
-- 3. Let org admins (not only platform admins) set their own org type, and
--    accept a type on organization creation.

-- ---- peer_profile: name gated on inter ----
create or replace function public.peer_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
    'name', case when v_inter then public.redacted_name(v_target.name) else v_target.name end,
    'department', v_target.department,
    'seniority', v_target.seniority,
    'job_title', case when v_inter then null else v_target.job_title end,
    'current_role', case when v_inter then null else v_target.job_title end,
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
$function$;

-- ---- get_matches_for: name gated on inter + structured extra reasons ----
create or replace function public.get_matches_for(p_role text default null, p_limit integer default null, p_offset integer default 0, p_include_directory boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
  v_aff jsonb;
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
        v_rating_reason := 'rating_excellent';
      elsif v_rating_avg >= 4.0 then
        v_rating_adjust := 3;
        v_rating_reason := 'rating_positive';
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

    -- Structured (localizable) extra reasons: { type, dept }.
    v_extra_reasons := '[]'::jsonb;
    if v_rating_reason is not null then
      v_extra_reasons := v_extra_reasons || jsonb_build_array(
        jsonb_build_object('type', v_rating_reason, 'dept', v_other.department));
    elsif v_accepts_count >= 1 then
      v_extra_reasons := v_extra_reasons || jsonb_build_array(
        jsonb_build_object('type', 'past_dept_positive', 'dept', v_other.department));
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
        'name', case when v_inter then public.redacted_name(v_other.name) else v_other.name end,
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

      v_aff := public.pair_affinity(v_viewer, v_other.id);

      select coalesce(jsonb_agg(jsonb_build_object('skill', skill, 'type', type, 'example_project', example_project)), '[]'::jsonb)
      into v_skills
      from public.skills where user_id = v_other.id and type = 'can_teach';

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'matchId', 'directory-' || v_other.id::text,
        'baseScore', (v_aff->>'score')::int,
        'adjustment', 0,
        'score', (v_aff->>'score')::int,
        'structuredReasons', v_aff->'reasons',
        'extraReasons', '[]'::jsonb,
        'user', jsonb_build_object(
          'id', v_other.id,
          'name', case when v_inter then public.redacted_name(v_other.name) else v_other.name end,
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
$function$;

grant execute on function public.get_matches_for(text, int, int, boolean) to authenticated;

-- ---- set_org_privacy: org admins may set their own org type ----
create or replace function public.set_org_privacy(p_type text default null, p_min_team_dashboard_size integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    if v_scope not in ('org', 'platform') then raise exception 'forbidden'; end if;
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
$function$;

-- ---- platform_create_organization: accept a type at creation ----
-- Drop the old single-arg signature so the new defaulted one isn't ambiguous.
drop function if exists public.platform_create_organization(text);
create or replace function public.platform_create_organization(p_name text, p_type text default 'intra')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_type text := coalesce(nullif(trim(p_type), ''), 'intra');
  v_base_slug text;
  v_slug text;
  v_suffix int := 1;
  v_org public.organizations;
begin
  if not public.is_platform_admin(v_caller) then raise exception 'platform_admin_only'; end if;
  if char_length(v_name) < 2 then raise exception 'organization_name_required'; end if;
  if v_type not in ('intra', 'inter') then raise exception 'invalid_type'; end if;

  v_base_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'organization';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  insert into public.organizations (name, slug, type)
  values (v_name, v_slug, v_type)
  returning * into v_org;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    v_caller,
    'platform.organization_create',
    'organization',
    v_org.id::text,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'type', v_org.type)
  );

  return jsonb_build_object(
    'organizationId', v_org.id,
    'organizationName', v_org.name,
    'slug', v_org.slug,
    'type', v_org.type,
    'totalUsers', 0,
    'onboarded', 0,
    'onboardingRate', 0,
    'activeMembers', 0,
    'sessions', 0,
    'churned', 0
  );
end;
$function$;
