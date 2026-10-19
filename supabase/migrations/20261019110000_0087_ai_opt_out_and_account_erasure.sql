-- Two member rights, both reachable without asking anyone.
--
-- 1. Opt out of AI (GDPR Art. 21). profiles.ai_opt_out keeps a member's data
--    away from the language model: they are not offered as a match, their
--    profile does not reach the matching or coverage prompts, and the
--    functions skip AI for their reflections and CV. The directory still
--    lists them; it does not use AI. discovery_candidates and
--    discovery_network_coverage are unchanged apart from that one condition.
--
-- 2. Erase an account (GDPR Art. 17). erase_account_data removes what the
--    member wrote and what describes them, and leaves the other side of shared
--    conversations readable: the sessions stay, the member's own messages,
--    notes and ratings go, and the profile becomes a deactivated "Former
--    member" placeholder so foreign keys and the other person's history hold.
--    Open requests and meetings are cancelled so nobody waits on them. Only the
--    delete-account Edge Function calls it, after checking who may erase whom;
--    it also scrubs the login itself. Audit rows keep ids and actions only.

alter table public.profiles
  add column if not exists ai_opt_out boolean not null default false,
  add column if not exists erased_at timestamptz;
grant update (ai_opt_out) on public.profiles to authenticated;

create or replace function public.discovery_candidates(
  p_organization_id uuid, p_viewer_id uuid, p_query text,
  p_selected_id uuid default null
)
returns jsonb language sql stable security definer set search_path = public as $$
  with query as (
    select websearch_to_tsquery('simple', coalesce(string_agg(token, ' OR '), '')) terms
    from regexp_split_to_table(left(coalesce(p_query, ''), 2000), '[^[:alnum:]_]+') token
    where length(token) > 1
  ), eligible as (
    select p.id, p.name, p.job_title, p.department, p.program, p.cohort_year,
      p.location, p.seniority, p.tenure_years, p.bio, p.linkedin_headline,
      coalesce(s.skills, '[]'::jsonb) skills,
      coalesce(h.experience, '[]'::jsonb) experience,
      coalesce(h.facts, '[]'::jsonb) experience_facts,
      ts_rank(
        setweight(to_tsvector('simple', concat_ws(' ', p.job_title, p.department, s.vocabulary)), 'A') ||
        setweight(to_tsvector('simple', concat_ws(' ', p.program, p.location, p.bio, h.vocabulary)), 'B'), q.terms
      ) relevance
    from public.profiles p cross join query q
    left join lateral (
      select jsonb_agg(skill order by lower(skill)) skills, string_agg(skill, ' ') vocabulary
      from public.skills where user_id = p.id and type = 'can_teach'
    ) s on true
    left join lateral (
      select jsonb_agg(line order by rn) experience,
             jsonb_agg(role_title order by rn) || coalesce(jsonb_agg(company order by rn) filter (where company is not null), '[]'::jsonb) facts,
             string_agg(concat_ws(' ', role_title, company, description), ' ') vocabulary
      from (
        select ch.role_title,
          nullif(btrim(coalesce(ch.company, '')), '') company,
          left(coalesce(ch.description, ''), 140) description,
          concat_ws(' ',
            case when nullif(btrim(coalesce(ch.company, '')), '') is null
              then ch.role_title else ch.role_title || ' at ' || btrim(ch.company) end,
            nullif('(' || concat_ws('-', ch.start_year, ch.end_year) || ')', '()'),
            nullif('- ' || left(btrim(coalesce(ch.description, '')), 140), '- ')
          ) line,
          row_number() over (
            order by coalesce(ch.end_year, 9999) desc, coalesce(ch.start_year, 0) desc, ch.id
          ) rn
        from public.career_history ch
        where ch.user_id = p.id and nullif(btrim(coalesce(ch.role_title, '')), '') is not null
      ) e
      where rn <= 3
    ) h on true
    where p.organization_id = p_organization_id and p.id <> p_viewer_id
      and p.admin_scope = 'none' and p.onboarding_complete and p.deactivated_at is null
      and not p.ai_opt_out
      and (p_selected_id is null or p.id = p_selected_id)
      and public.is_currently_available_mentor(p.id)
      and not exists (
        select 1 from public.sessions active where
          ((active.mentor_id = p.id and active.mentee_id = p_viewer_id)
            or (active.mentee_id = p.id and active.mentor_id = p_viewer_id))
          and (active.status = 'scheduled' or (active.status = 'pending'
            and (active.request_expires_at is null or active.request_expires_at > now())))
      )
  ), ranked as (
    select * from eligible order by relevance desc, lower(name), id limit 250
  )
  select coalesce(jsonb_agg(to_jsonb(r) - 'relevance' order by relevance desc, lower(name), id), '[]'::jsonb)
  from ranked r
$$;

create or replace function public.discovery_network_coverage(p_organization_id uuid, p_viewer_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with members as materialized (
    select id, department, program, job_title from public.profiles
    where organization_id = p_organization_id and id <> p_viewer_id
      and admin_scope = 'none' and onboarding_complete and deactivated_at is null and not ai_opt_out
  ), vocabulary as (
    select 'departments' kind, department value from members
    union select 'programs', program from members
    union select 'job_titles', job_title from members
    union select 'skills', s.skill from public.skills s join members m on m.id = s.user_id where s.type = 'can_teach'
  ), bounded as (
    select kind, left(trim(value), 80) value,
      row_number() over (partition by kind order by value) position
    from vocabulary where coalesce(trim(value), '') <> ''
  ), summaries as (
    select kind, jsonb_agg(value order by value) values from bounded
    where position <= case kind when 'job_titles' then 120 when 'skills' then 250 else 40 end
    group by kind
  )
  select jsonb_build_object('member_count', (select count(*) from members),
    'departments', coalesce((select values from summaries where kind = 'departments'), '[]'::jsonb),
    'programs', coalesce((select values from summaries where kind = 'programs'), '[]'::jsonb),
    'job_titles', coalesce((select values from summaries where kind = 'job_titles'), '[]'::jsonb),
    'skills', coalesce((select values from summaries where kind = 'skills'), '[]'::jsonb))
$$;
revoke all on function public.discovery_network_coverage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discovery_network_coverage(uuid, uuid) to service_role;

create or replace function public.erase_account_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target public.profiles; cancelled integer; next_owner uuid; owned record;
begin
  select * into target from public.profiles where id = p_user_id for update;
  if target.id is null then raise exception 'user_not_found'; end if;
  if target.admin_scope <> 'none' or target.is_admin then raise exception 'admin_account'; end if;

  -- Nobody is left waiting on a request or a meeting with this person.
  update public.sessions set status = 'cancelled'
    where p_user_id in (mentor_id, mentee_id) and status in ('pending', 'scheduled');
  get diagnostics cancelled = row_count;
  -- Shared sessions stay for the other person; this member's words leave them.
  update public.sessions set outbound_message = '', pre_session_question = '', reflection = '', mentee_rating = null
    where mentee_id = p_user_id;
  update public.sessions set mentor_reflection = '', mentor_rating = null where mentor_id = p_user_id;
  delete from public.session_messages where sender_id = p_user_id;
  delete from public.session_reads where user_id = p_user_id;

  -- A group they own passes to its longest-standing member, or closes if empty.
  for owned in select id from public.groups where created_by = p_user_id loop
    select user_id into next_owner from public.group_members
      where group_id = owned.id and user_id <> p_user_id order by created_at, user_id limit 1;
    if next_owner is null then
      delete from public.groups where id = owned.id;
    else
      update public.groups set created_by = next_owner where id = owned.id;
      update public.group_members set role = 'owner' where group_id = owned.id and user_id = next_owner;
    end if;
  end loop;
  delete from public.group_messages where sender_id = p_user_id;
  delete from public.group_members where user_id = p_user_id;
  delete from public.group_join_requests where user_id = p_user_id;
  delete from public.group_reads where user_id = p_user_id;

  delete from public.skills where user_id = p_user_id;
  delete from public.career_history where user_id = p_user_id;
  delete from public.profile_drafts where user_id = p_user_id;
  delete from public.reflection_logs where user_id = p_user_id;
  delete from public.mentorship_unavailable_periods where user_id = p_user_id;
  delete from public.connections where p_user_id in (requester_id, addressee_id);
  delete from public.match_scores where p_user_id in (user_a_id, user_b_id);
  delete from public.discovery_threads where user_id = p_user_id;
  delete from public.discovery_feedback where user_id = p_user_id;
  update public.discovery_feedback set profile_id = null where profile_id = p_user_id;
  update public.discovery_threads set selected_person_id = null where selected_person_id = p_user_id;
  delete from public.feedback_messages where user_id = p_user_id;
  delete from public.continuation_intents where user_id = p_user_id;
  delete from public.outcome_events where actor_id = p_user_id;
  update public.outcome_events set recipient_id = null where recipient_id = p_user_id;
  delete from public.calendar_connections where user_id = p_user_id;
  delete from public.calendar_events where owner_id = p_user_id;
  delete from public.calendar_event_claims where owner_id = p_user_id;
  delete from public.notification_outbox where user_id = p_user_id;
  delete from public.consent_records where user_id = p_user_id;
  update public.ai_runs set user_id = null where user_id = p_user_id;
  update public.outreach_targets set email = null where profile_id = p_user_id;
  update public.invitations set email = 'erased-' || id || '@invalid', profile_data = '{}'::jsonb
    where accepted_user_id = p_user_id;

  update public.profiles set
    name = 'Former member', department = '', job_title = '', bio = '', location = '',
    shadow_role_response = '', program = '', cohort_year = null, tenure_years = 0,
    linkedin_url = null, linkedin_headline = null, notification_email = null,
    external_source = null, external_id = null, source_synced_at = null, manager_id = null,
    mentorship_note = null, mentorship_paused = true, reflection_email_reminders = false,
    ai_opt_out = true, onboarding_complete = false,
    deactivated_at = coalesce(deactivated_at, now()), erased_at = now()
  where id = p_user_id;
  update public.profiles set manager_id = null where manager_id = p_user_id;

  return jsonb_build_object('erased', true, 'cancelled_sessions', cancelled);
end $$;
revoke all on function public.erase_account_data(uuid) from public, anon, authenticated;
grant execute on function public.erase_account_data(uuid) to service_role;

notify pgrst, 'reload schema';
