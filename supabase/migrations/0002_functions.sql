-- =====================================================================
-- Triggers and SQL functions. All security-definer with locked search_path.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profile auto-create on signup
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, name, department, seniority, job_title, tenure_years, location, bio,
    must_change_password, is_admin, onboarding_complete
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'department', ''),
    coalesce(new.raw_user_meta_data->>'seniority', 'junior'),
    coalesce(new.raw_user_meta_data->>'job_title', ''),
    coalesce((new.raw_user_meta_data->>'tenure_years')::int, 0),
    coalesce(new.raw_user_meta_data->>'location', ''),
    coalesce(new.raw_user_meta_data->>'bio', ''),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true),
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false),
    coalesce((new.raw_user_meta_data->>'onboarding_complete')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = p_user_id), false);
$$;

-- Block protected column updates from anyone but service_role and definer
-- functions. Splits "self-edit your bio" from "promote yourself to admin".
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
  if new.is_admin is distinct from old.is_admin
     or new.manager_id is distinct from old.manager_id
     or new.deactivated_at is distinct from old.deactivated_at
     or new.must_change_password is distinct from old.must_change_password
     or new.pending_checkin is distinct from old.pending_checkin then
    raise exception 'protected_columns: only service_role can change is_admin, manager_id, deactivated_at, must_change_password, pending_checkin';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_writes_trg on public.profiles;
create trigger guard_profile_writes_trg
before update on public.profiles
for each row execute function public.guard_profile_writes();

-- ---------------------------------------------------------------------
-- Audit log: one generic trigger function reused on each interesting table.
-- Sensitive content (reflection text, profile field values) is never written.
-- ---------------------------------------------------------------------

create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_action text;
  v_target_id text;
  v_meta jsonb := '{}'::jsonb;
begin
  v_target_id := coalesce(
    nullif((to_jsonb(coalesce(new, old))->>'id'), ''),
    ''
  );

  if tg_table_name = 'sessions' then
    if tg_op = 'INSERT' then
      v_action := 'session.request';
      v_meta := jsonb_build_object('mentor_id', new.mentor_id, 'topic_count', jsonb_array_length(new.topics));
    elsif tg_op = 'UPDATE' then
      if new.status = 'scheduled' and old.status = 'pending' then
        v_action := 'session.accept';
      elsif new.status = 'completed' and old.status <> 'completed' then
        v_action := 'session.complete';
      elsif new.status in ('declined','cancelled') and old.status not in ('declined','cancelled') then
        v_action := 'session.cancel';
      elsif new.scheduled_at is distinct from old.scheduled_at then
        v_action := 'session.reschedule';
      elsif new.mentee_rating is distinct from old.mentee_rating
            or new.mentor_rating is distinct from old.mentor_rating then
        v_action := 'session.rated';
        v_meta := jsonb_build_object(
          'mentee_rating', new.mentee_rating,
          'mentor_rating', new.mentor_rating
        );
      elsif new.reflection is distinct from old.reflection
            or new.mentor_reflection is distinct from old.mentor_reflection then
        v_action := 'session.reflection_added';
      else
        return coalesce(new, old);
      end if;
    end if;
  elsif tg_table_name = 'connections' then
    if tg_op = 'INSERT' then
      v_action := 'connection.create';
      v_meta := jsonb_build_object('addressee_id', new.addressee_id, 'status', new.status);
    elsif tg_op = 'UPDATE' then
      v_action := 'connection.update';
      v_meta := jsonb_build_object('status', new.status);
    end if;
  elsif tg_table_name = 'profiles' then
    if tg_op = 'UPDATE' then
      if new.deactivated_at is not null and old.deactivated_at is null then
        v_action := 'admin.user_deactivated';
      elsif new.manager_id is distinct from old.manager_id then
        v_action := 'admin.user_manager_updated';
        v_meta := jsonb_build_object('manager_id', new.manager_id);
      elsif new.must_change_password and not old.must_change_password then
        v_action := 'admin.password_reset';
      else
        return new;
      end if;
    end if;
  elsif tg_table_name = 'reflection_logs' then
    if tg_op = 'INSERT' then
      v_action := 'reflection.submit';
      v_meta := jsonb_build_object(
        'classifier', new.classifier_source,
        'gap_count', jsonb_array_length(new.extracted_gaps),
        'strength_count', jsonb_array_length(new.extracted_strengths)
      );
    elsif tg_op = 'UPDATE' and new.applied and not old.applied then
      v_action := 'reflection.apply';
    end if;
  elsif tg_table_name = 'profile_drafts' then
    if tg_op = 'INSERT' then
      v_action := 'profile.ingest';
      v_meta := jsonb_build_object('source', new.source, 'classifier_source', new.classifier_source);
    elsif tg_op = 'UPDATE' and new.accepted_at is not null and old.accepted_at is null then
      v_action := 'profile.draft_accepted';
    end if;
  end if;

  if v_action is null then
    return coalesce(new, old);
  end if;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_actor, v_action, tg_table_name, v_target_id, v_meta);

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_sessions on public.sessions;
create trigger audit_sessions
after insert or update on public.sessions
for each row execute function public.log_audit();

drop trigger if exists audit_connections on public.connections;
create trigger audit_connections
after insert or update on public.connections
for each row execute function public.log_audit();

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
after update on public.profiles
for each row execute function public.log_audit();

drop trigger if exists audit_reflections on public.reflection_logs;
create trigger audit_reflections
after insert or update on public.reflection_logs
for each row execute function public.log_audit();

drop trigger if exists audit_drafts on public.profile_drafts;
create trigger audit_drafts
after insert or update on public.profile_drafts
for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Skill landscape: per-skill session counts (replaces JS correlated subquery)
-- ---------------------------------------------------------------------

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
  where s.user_id = p_user_id;
$$;

-- Distinct can_teach skills the user has actually mentored on a completed
-- session — for the "what colleagues seek you out for" pill row.
create or replace function public.expertise_signature_for(p_user_id uuid)
returns table (skill text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.skill
  from public.skills s
  join public.sessions sess on sess.mentor_id = s.user_id and sess.status = 'completed'
  where s.user_id = p_user_id and s.type = 'can_teach';
$$;

-- ---------------------------------------------------------------------
-- Badges (replaces server/routes/users.js computeBadges)
-- ---------------------------------------------------------------------

create or replace function public.badges_for(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_dept text;
  v_first_step boolean;
  v_dept_count int;
  v_mentor_count int;
  v_explorer boolean;
begin
  select department into v_user_dept from public.profiles where id = p_user_id;
  if v_user_dept is null then
    return '[]'::jsonb;
  end if;

  v_first_step := exists (
    select 1 from public.sessions
    where (mentor_id = p_user_id or mentee_id = p_user_id) and status = 'completed'
  );

  select count(distinct case when s.mentor_id = p_user_id then mp.department else mtp.department end)
  into v_dept_count
  from public.sessions s
  left join public.profiles mp on mp.id = s.mentee_id
  left join public.profiles mtp on mtp.id = s.mentor_id
  where (s.mentor_id = p_user_id or s.mentee_id = p_user_id) and s.status = 'completed';

  select count(*) into v_mentor_count from public.sessions where mentor_id = p_user_id;

  v_explorer := exists (
    select 1 from public.sessions s
    join public.profiles other on other.id = case when s.mentor_id = p_user_id then s.mentee_id else s.mentor_id end
    where (s.mentor_id = p_user_id or s.mentee_id = p_user_id)
      and other.department <> v_user_dept
      and s.status = 'completed'
  );

  return jsonb_build_array(
    jsonb_build_object('id','first_step','label','First Step','icon','🌱',
      'description','Completed your first mentoring session',
      'condition','Complete your first session','earned', v_first_step),
    jsonb_build_object('id','connector','label','Connector','icon','🔗',
      'description','Connected with colleagues from 3+ different departments',
      'condition','Complete sessions with people from 3 different departments','earned', v_dept_count >= 3),
    jsonb_build_object('id','deep_expert','label','Deep Expert','icon','⭐',
      'description','Requested as a mentor 5+ times',
      'condition','Be requested as a mentor 5 times','earned', v_mentor_count >= 5),
    jsonb_build_object('id','explorer','label','Explorer','icon','🧭',
      'description','Ventured outside your department for a mentoring session',
      'condition','Complete a session with someone from a completely different department','earned', v_explorer)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Team skill gaps (replaces server/routes/team.js)
-- ---------------------------------------------------------------------

create or replace function public.team_skill_gaps(p_manager_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_for_report constant int := 3;
  v_reports uuid[];
  v_count int;
  v_gaps jsonb;
  v_strengths jsonb;
begin
  select coalesce(array_agg(id), '{}') into v_reports
  from public.profiles
  where manager_id = p_manager_id and not is_admin;

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

  with norm as (
    select user_id, lower(trim(skill)) as norm_skill, max(skill) as display, type
    from public.skills
    where user_id = any(v_reports)
    group by user_id, lower(trim(skill)), type
  ),
  agg as (
    select type, norm_skill, max(display) as display, count(*)::int as cnt
    from norm
    group by type, norm_skill
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('skill', display, 'count', cnt, 'share', round(cnt::numeric * 100 / v_count)))
      filter (where type = 'wants_to_learn'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('skill', display, 'count', cnt, 'share', round(cnt::numeric * 100 / v_count)))
      filter (where type = 'can_teach'), '[]'::jsonb)
  into v_gaps, v_strengths
  from (
    select * from agg order by cnt desc, display asc
  ) ordered;

  return jsonb_build_object(
    'reportCount', v_count, 'gated', false,
    'gaps', (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from (
        select jsonb_array_elements(v_gaps) x limit 5
      ) y
    ),
    'strengths', (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from (
        select jsonb_array_elements(v_strengths) x limit 5
      ) y
    ),
    'message', null
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Session lifecycle: request, accept, complete, decline, rate
-- ---------------------------------------------------------------------

create or replace function public.compute_session_topics(p_mentor_id uuid, p_mentee_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(skill order by skill), '[]'::jsonb)
  from (
    select distinct on (lower(trim(t.skill))) t.skill
    from public.skills t
    where t.user_id = p_mentor_id and t.type = 'can_teach'
      and exists (
        select 1 from public.skills l
        where l.user_id = p_mentee_id and l.type = 'wants_to_learn'
          and lower(trim(l.skill)) = lower(trim(t.skill))
      )
    limit 5
  ) overlap;
$$;

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
  v_mentor public.profiles;
  v_topics jsonb;
  v_session public.sessions;
begin
  if v_caller is null then
    raise exception 'auth_required';
  end if;
  if v_caller = p_mentor_id then
    raise exception 'cannot_book_self';
  end if;

  select * into v_mentor from public.profiles where id = p_mentor_id;
  if v_mentor.id is null then
    raise exception 'mentor_not_found';
  end if;
  if v_mentor.deactivated_at is not null then
    raise exception 'mentor_deactivated';
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

create or replace function public.accept_session(p_session_id bigint, p_scheduled_at timestamptz default null)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_session.mentor_id <> v_caller then raise exception 'forbidden'; end if;

  update public.sessions
  set status = 'scheduled',
      scheduled_at = coalesce(p_scheduled_at, v_session.scheduled_at)
  where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.cancel_session(p_session_id bigint, p_status text default 'cancelled')
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
begin
  if p_status not in ('declined','cancelled') then
    raise exception 'invalid_status';
  end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then
    raise exception 'forbidden';
  end if;
  update public.sessions set status = p_status where id = p_session_id returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.complete_session(
  p_session_id bigint,
  p_reflection text default null,
  p_rating int default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
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
    perform public.recompute_matches_for(v_session.mentor_id);
    perform public.recompute_matches_for(v_session.mentee_id);
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  return v_session;
end;
$$;

create or replace function public.reschedule_session(p_session_id bigint, p_scheduled_at timestamptz)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session public.sessions;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session_not_found'; end if;
  if v_caller not in (v_session.mentor_id, v_session.mentee_id) then
    raise exception 'forbidden';
  end if;
  update public.sessions set scheduled_at = p_scheduled_at where id = p_session_id returning * into v_session;
  return v_session;
end;
$$;

-- ---------------------------------------------------------------------
-- Connection upsert (declined = "not interested", drives match dismissal)
-- ---------------------------------------------------------------------

create or replace function public.upsert_connection(
  p_addressee_id uuid,
  p_status text default 'pending'
)
returns public.connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if v_caller = p_addressee_id then raise exception 'cannot_connect_self'; end if;
  if p_status not in ('pending','accepted','declined') then raise exception 'invalid_status'; end if;

  insert into public.connections (requester_id, addressee_id, status)
  values (v_caller, p_addressee_id, p_status)
  on conflict (requester_id, addressee_id)
  do update set status = excluded.status
  returning * into v_conn;

  return v_conn;
end;
$$;

create or replace function public.update_connection_status(p_id bigint, p_status text)
returns public.connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections;
begin
  if p_status not in ('accepted','declined') then raise exception 'invalid_status'; end if;
  select * into v_conn from public.connections where id = p_id for update;
  if v_conn.id is null then raise exception 'not_found'; end if;
  if v_caller not in (v_conn.requester_id, v_conn.addressee_id) then
    raise exception 'forbidden';
  end if;
  update public.connections set status = p_status where id = p_id returning * into v_conn;
  return v_conn;
end;
$$;

-- ---------------------------------------------------------------------
-- Reflection apply: copy extracted gaps/strengths into skills
-- ---------------------------------------------------------------------

create or replace function public.apply_reflection(
  p_reflection_id bigint,
  p_gaps jsonb default null,
  p_strengths jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_log public.reflection_logs;
  v_gaps jsonb;
  v_strengths jsonb;
  v_added int := 0;
  v_added_skills jsonb := '[]'::jsonb;
  v_skill text;
begin
  select * into v_log from public.reflection_logs where id = p_reflection_id and user_id = v_caller;
  if v_log.id is null then raise exception 'not_found'; end if;

  v_gaps := coalesce(p_gaps, v_log.extracted_gaps);
  v_strengths := coalesce(p_strengths, v_log.extracted_strengths);

  for v_skill in select trim(jsonb_array_elements_text(v_gaps)) loop
    if v_skill = '' then continue; end if;
    if not exists (
      select 1 from public.skills
      where user_id = v_caller and type = 'wants_to_learn'
        and lower(trim(skill)) = lower(v_skill)
    ) then
      insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'wants_to_learn');
      v_added := v_added + 1;
      v_added_skills := v_added_skills || jsonb_build_array(jsonb_build_object('skill', v_skill, 'type', 'wants_to_learn'));
    end if;
  end loop;

  for v_skill in select trim(jsonb_array_elements_text(v_strengths)) loop
    if v_skill = '' then continue; end if;
    if not exists (
      select 1 from public.skills
      where user_id = v_caller and type = 'can_teach'
        and lower(trim(skill)) = lower(v_skill)
    ) then
      insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'can_teach');
      v_added := v_added + 1;
      v_added_skills := v_added_skills || jsonb_build_array(jsonb_build_object('skill', v_skill, 'type', 'can_teach'));
    end if;
  end loop;

  update public.reflection_logs set applied = true where id = p_reflection_id;
  perform public.recompute_matches_for(v_caller);

  return jsonb_build_object('added', v_added, 'addedSkills', v_added_skills);
end;
$$;

-- ---------------------------------------------------------------------
-- Match recompute: pure SQL port of server/utils/matching.js computeScore.
-- Idempotent. Caller passes one user; recompute touches all their pairs.
-- ---------------------------------------------------------------------

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
  select * into v_target from public.profiles where id = p_user_id and not is_admin;
  if v_target.id is null then return 0; end if;

  for v_other in
    select * from public.profiles where not is_admin and id <> p_user_id
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
    else
      delete from public.match_scores where user_a_id = v_a and user_b_id = v_b;
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
  for v_user in select id from public.profiles where not is_admin loop
    perform public.recompute_matches_for(v_user.id);
  end loop;
  select count(*) into v_total from public.match_scores;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- Match listing for the viewer: applies preferences + role filter and
-- returns the same shape the client used to build from /api/matches.
-- ---------------------------------------------------------------------

create or replace function public.is_mentor_leaning(p_reasons jsonb, p_viewer_id uuid, p_other_id uuid)
returns boolean
language sql
immutable
as $$
  with scored as (
    select
      sum(case when (r->>'type') = 'teach_overlap' and (r->>'teacher_id')::uuid = p_other_id then 2 else 0 end) as mentor,
      sum(case when (r->>'type') = 'teach_overlap' and (r->>'teacher_id')::uuid = p_viewer_id then 2 else 0 end) +
      sum(case when (r->>'type') = 'career_bridge' and (r->>'who_id')::uuid = p_viewer_id then 1 else 0 end) as mentee
    from jsonb_array_elements(p_reasons) r
  )
  select coalesce((select mentor from scored), 0) >= coalesce((select mentee from scored), 0);
$$;

create or replace function public.get_matches_for(
  p_role text default null,
  p_limit int default null,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_dismissed uuid[];
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

  select coalesce(array_agg(addressee_id), '{}') into v_dismissed
  from public.connections
  where requester_id = v_viewer and status = 'declined';

  for r in
    select ms.*, case when ms.user_a_id = v_viewer then ms.user_b_id else ms.user_a_id end as other_id
    from public.match_scores ms
    where (ms.user_a_id = v_viewer or ms.user_b_id = v_viewer)
  loop
    v_other_id := r.other_id;
    if v_other_id = any(v_dismissed) then continue; end if;
    if p_role = 'mentor' and not public.is_mentor_leaning(r.reasons, v_viewer, v_other_id) then continue; end if;

    select * into v_other from public.profiles where id = v_other_id;
    if v_other.id is null or v_other.deactivated_at is not null then continue; end if;

    -- Per-dept rating-bucket adjustment
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

    -- Per-dept accept/decline volumes
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

    -- Surface only can_teach skills for the candidate card
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
        'name', case when v_other.deactivated_at is not null then '[Former colleague]' else v_other.name end,
        'department', v_other.department,
        'seniority', v_other.seniority,
        'job_title', v_other.job_title,
        'location', v_other.location,
        'bio', v_other.bio,
        'skills', v_skills
      )
    ));
  end loop;

  -- Sort by adjusted score desc
  with arr as (
    select jsonb_array_elements(v_results) as m
  ),
  sorted as (
    select m, (m->>'score')::int as s from arr order by s desc
  )
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_results from sorted;

  v_total := jsonb_array_length(v_results);

  if p_limit is not null then
    with arr as (select jsonb_array_elements(v_results) as m, generate_series(0, jsonb_array_length(v_results) - 1) as idx)
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

-- ---------------------------------------------------------------------
-- Onboarding atomic save (used by Profile and Onboarding pages)
-- ---------------------------------------------------------------------

create or replace function public.save_onboarding(
  p_name text,
  p_department text,
  p_seniority text,
  p_job_title text,
  p_bio text,
  p_shadow_role_response text,
  p_tenure_years int,
  p_location text,
  p_career jsonb,
  p_can_teach jsonb,
  p_wants_to_learn jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_entry jsonb;
  v_skill text;
begin
  if v_caller is null then raise exception 'auth_required'; end if;

  update public.profiles set
    name = coalesce(p_name, name),
    department = coalesce(p_department, department),
    seniority = case when p_seniority in ('junior','mid','senior','lead') then p_seniority else 'junior' end,
    job_title = coalesce(p_job_title, job_title),
    bio = coalesce(p_bio, bio),
    shadow_role_response = coalesce(p_shadow_role_response, shadow_role_response),
    tenure_years = coalesce(p_tenure_years, tenure_years),
    location = coalesce(p_location, location),
    onboarding_complete = true
  where id = v_caller;

  delete from public.career_history where user_id = v_caller;
  if p_career is not null and jsonb_typeof(p_career) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_career) loop
      if (v_entry->>'role_title') is not null and (v_entry->>'department') is not null then
        insert into public.career_history (
          user_id, role_title, department, company, description,
          start_year, start_month, end_year, end_month
        ) values (
          v_caller,
          v_entry->>'role_title',
          v_entry->>'department',
          coalesce(v_entry->>'company', ''),
          coalesce(v_entry->>'description', ''),
          (v_entry->>'start_year')::int,
          (v_entry->>'start_month')::int,
          (v_entry->>'end_year')::int,
          (v_entry->>'end_month')::int
        );
      end if;
    end loop;
  end if;

  delete from public.skills where user_id = v_caller;
  if p_can_teach is not null and jsonb_typeof(p_can_teach) = 'array' then
    for v_skill in select trim(jsonb_array_elements_text(p_can_teach)) loop
      if v_skill <> '' then
        insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'can_teach');
      end if;
    end loop;
  end if;
  if p_wants_to_learn is not null and jsonb_typeof(p_wants_to_learn) = 'array' then
    for v_skill in select trim(jsonb_array_elements_text(p_wants_to_learn)) loop
      if v_skill <> '' then
        insert into public.skills (user_id, skill, type) values (v_caller, v_skill, 'wants_to_learn');
      end if;
    end loop;
  end if;

  perform public.recompute_matches_for(v_caller);
end;
$$;

-- ---------------------------------------------------------------------
-- Admin-only stat helpers used by the dashboard
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
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return jsonb_build_object(
    'totalUsers', (select count(*) from public.profiles where not is_admin and deactivated_at is null),
    'onboarded', (select count(*) from public.profiles where not is_admin and onboarding_complete and deactivated_at is null),
    'onboardingRate', (
      select case when count(*) = 0 then 0
        else round(count(*) filter (where onboarding_complete) * 100.0 / count(*))
      end
      from public.profiles where not is_admin and deactivated_at is null
    ),
    'totalMatches', (select count(*) from public.match_scores),
    'sessionsByStatus', coalesce(
      (select jsonb_agg(jsonb_build_object('status', status, 'cnt', cnt))
       from (select status, count(*)::int as cnt from public.sessions group by status) s),
      '[]'::jsonb
    ),
    'topMentors', coalesce(
      (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department, 'seniority', seniority, 'session_count', session_count))
       from (
         select p.id, p.name, p.department, p.seniority, count(s.id)::int as session_count
         from public.profiles p
         join public.sessions s on s.mentor_id = p.id and s.status = 'completed'
         where p.deactivated_at is null
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
         where not p.is_admin and p.deactivated_at is null
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
  v_users jsonb;
  v_total int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  select count(*) into v_total from public.profiles where not is_admin;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id,
    'email', au.email,
    'name', u.name,
    'department', u.department,
    'job_title', u.job_title,
    'onboarding_complete', u.onboarding_complete,
    'deactivated_at', u.deactivated_at,
    'must_change_password', u.must_change_password,
    'manager_email', m_au.email
  )), '[]'::jsonb)
  into v_users
  from public.profiles u
  join auth.users au on au.id = u.id
  left join public.profiles m on m.id = u.manager_id
  left join auth.users m_au on m_au.id = m.id
  where not u.is_admin
  order by u.name
  limit p_limit offset p_offset;

  return jsonb_build_object('users', v_users, 'total', v_total);
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
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;

  return jsonb_build_object(
    'total', (select count(*) from public.audit_logs),
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
      from (select * from public.audit_logs order by id desc limit p_limit) a
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
  v_mgr_id uuid;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  if p_user_id = v_caller then raise exception 'cannot_set_self'; end if;

  if p_manager_email is null or trim(p_manager_email) = '' then
    update public.profiles set manager_id = null where id = p_user_id;
    return;
  end if;

  select au.id into v_mgr_id
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(au.email) = lower(trim(p_manager_email))
    and p.deactivated_at is null;
  if v_mgr_id is null then raise exception 'manager_not_found'; end if;
  if v_mgr_id = p_user_id then raise exception 'cannot_self_manage'; end if;

  update public.profiles set manager_id = v_mgr_id where id = p_user_id;
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
  update public.profiles set deactivated_at = now() where id = p_user_id;
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
  v_count int;
begin
  if not public.is_admin(v_caller) then raise exception 'admin_only'; end if;
  update public.profiles set pending_checkin = true where not is_admin and deactivated_at is null;
  get diagnostics v_count = row_count;
  insert into public.audit_logs (actor_id, action, metadata)
  values (v_caller, 'admin.broadcast_checkin', jsonb_build_object('recipients', v_count));
  return v_count;
end;
$$;

create or replace function public.acknowledge_checkin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  update public.profiles set pending_checkin = false where id = v_caller;
end;
$$;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  update public.profiles set must_change_password = false where id = v_caller;
end;
$$;
