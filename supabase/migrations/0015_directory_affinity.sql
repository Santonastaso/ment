-- Make Explorer directory results "alive".
--
-- get_matches_for has two sources:
--   1. Stored match_scores (pairs that scored >= 30) — real, varied scores.
--   2. Directory fill — everyone else in the org, previously appended with a
--      hardcoded score of 0. That produced a wall of "0/100 · Worth a look"
--      cards in Explorer below the real matches.
--
-- This migration computes a real, on-the-fly affinity for directory-fill
-- candidates using the same signals as recompute_matches_for (skill overlap,
-- career crossover, department diversity) — just without the >= 30 storage
-- threshold — so every Explorer card shows a meaningful, varied percentage
-- and a reason instead of 0.

create or replace function public.pair_affinity(p_a uuid, p_b uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_score int := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_a_teaches text[];
  v_a_learns text[];
  v_b_teaches text[];
  v_b_learns text[];
  v_a_career_depts text[];
  v_b_career_depts text[];
  v_b_teach_a_learn text[];
  v_a_teach_b_learn text[];
  v_skill_count int;
  v_a_dept text;
  v_b_dept text;
begin
  select array_agg(distinct lower(trim(skill))) filter (where type = 'can_teach'),
         array_agg(distinct lower(trim(skill))) filter (where type = 'wants_to_learn')
    into v_a_teaches, v_a_learns
  from public.skills where user_id = p_a;
  select array_agg(distinct lower(trim(skill))) filter (where type = 'can_teach'),
         array_agg(distinct lower(trim(skill))) filter (where type = 'wants_to_learn')
    into v_b_teaches, v_b_learns
  from public.skills where user_id = p_b;

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
      'type', 'teach_overlap', 'teacher_id', p_b, 'learner_id', p_a,
      'skills', to_jsonb(v_b_teach_a_learn[1:3])
    ));
  end if;
  if array_length(v_a_teach_b_learn, 1) > 0 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'type', 'teach_overlap', 'teacher_id', p_a, 'learner_id', p_b,
      'skills', to_jsonb(v_a_teach_b_learn[1:3])
    ));
  end if;

  select array_agg(department) into v_a_career_depts from public.career_history where user_id = p_a;
  select array_agg(department) into v_b_career_depts from public.career_history where user_id = p_b;
  v_a_career_depts := coalesce(v_a_career_depts, '{}');
  v_b_career_depts := coalesce(v_b_career_depts, '{}');

  select department into v_a_dept from public.profiles where id = p_a;
  select department into v_b_dept from public.profiles where id = p_b;

  if v_a_dept = any(v_b_career_depts) then
    v_score := v_score + 20;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'type', 'career_bridge', 'who_id', p_b, 'into_dept', v_a_dept));
  elsif v_b_dept = any(v_a_career_depts) then
    v_score := v_score + 20;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'type', 'career_bridge', 'who_id', p_a, 'into_dept', v_b_dept));
  end if;

  if v_a_dept is distinct from v_b_dept then
    v_score := v_score + 25;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'type', 'dept_diversity',
      'a_id', p_a, 'a_dept', v_a_dept,
      'b_id', p_b, 'b_dept', v_b_dept));
  end if;

  return jsonb_build_object('score', greatest(0, least(100, v_score)), 'reasons', v_reasons);
end;
$$;

grant execute on function public.pair_affinity(uuid, uuid) to authenticated;

-- Re-create get_matches_for (latest definition lives in 0013) with the
-- directory-fill branch using pair_affinity instead of a hardcoded 0.
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

      -- Real, computed affinity instead of a hardcoded 0.
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
