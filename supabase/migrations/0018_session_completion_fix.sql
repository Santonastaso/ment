-- 0018 Session completion fix (F11)
--
-- Bug: complete_session() recomputes matches for BOTH participants once both
-- sides have completed. recompute_matches_for() raises 'forbidden' when called
-- for a user other than auth.uid() (and the caller is not an admin), so the
-- second participant to complete always errored out -> client stuck on
-- "Saving...". Fix: split the unguarded recompute logic into an internal
-- function that complete_session can call for both users, and keep the public
-- recompute_matches_for() as a thin guarded wrapper for direct callers.

-- Internal: identical matching logic, no auth guard. SECURITY DEFINER, not
-- granted to anon/authenticated, only reachable from other SECURITY DEFINER
-- functions in this schema.
create or replace function public._recompute_matches_for(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public._recompute_matches_for(uuid) from public, anon, authenticated;

-- Public wrapper keeps the existing authorization contract for direct callers.
create or replace function public.recompute_matches_for(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id and not public.is_admin(auth.uid()) then
    raise exception 'forbidden';
  end if;
  return public._recompute_matches_for(p_user_id);
end;
$function$;

-- complete_session now recomputes via the internal function for both parties,
-- so the second participant to complete no longer trips the auth guard.
create or replace function public.complete_session(p_session_id bigint, p_reflection text default null, p_rating integer default null)
returns public.sessions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
  v_is_mentor boolean;
  v_both boolean;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then
    raise exception 'forbidden';
  end if;
  v_is_mentor := v_session.mentor_id = v_caller;

  if v_is_mentor then
    update public.sessions
    set mentor_completed_at = now(),
        mentor_reflection = coalesce(p_reflection, mentor_reflection),
        mentor_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentor_rating)
    where id = p_session_id;
  else
    update public.sessions
    set mentee_completed_at = now(),
        reflection = coalesce(p_reflection, reflection),
        mentee_rating = coalesce(case when p_rating between 1 and 5 then p_rating end, mentee_rating)
    where id = p_session_id;
  end if;

  select mentor_completed_at is not null and mentee_completed_at is not null
  into v_both
  from public.sessions where id = p_session_id;

  if v_both then
    update public.sessions set status = 'completed' where id = p_session_id;
    perform public._recompute_matches_for(v_session.mentor_id);
    perform public._recompute_matches_for(v_session.mentee_id);
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  return v_session;
end;
$function$;
