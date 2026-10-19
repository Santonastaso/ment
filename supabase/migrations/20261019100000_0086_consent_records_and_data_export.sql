-- GDPR groundwork, no behaviour change for existing flows.
--
-- consent_records: who agreed to what, to which text version, and when (Art. 7).
-- Rows are written only through record_consent, which takes the user and the
-- time from the server; a member can read their own rows and nothing else.
--
-- export_my_data: one JSON document with the caller's own data (Art. 15/20).
-- It is scoped to auth.uid() and leaves out what belongs to someone else or
-- would be a credential: the other side's reflection and rating on a shared
-- session, other people's messages, calendar tokens, invitation hashes and
-- capability links.

create table public.consent_records (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('ai_profile_import')),
  text_version text not null check (length(text_version) between 1 and 40),
  locale text not null default 'en' check (locale in ('en', 'it', 'fr')),
  accepted_at timestamptz not null default now()
);
create index consent_records_user_idx on public.consent_records (user_id, accepted_at desc);

alter table public.consent_records enable row level security;
revoke all on public.consent_records from public, anon, authenticated;
grant select on public.consent_records to authenticated;
create policy consent_records_own_read on public.consent_records
  for select to authenticated using (user_id = auth.uid());

create or replace function public.record_consent(p_purpose text, p_text_version text, p_locale text default 'en')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); row public.consent_records;
begin
  if me is null then raise exception 'auth_required'; end if;
  insert into public.consent_records (user_id, purpose, text_version, locale)
    values (me, p_purpose, p_text_version, coalesce(nullif(p_locale, ''), 'en'))
    returning * into row;
  return jsonb_build_object('purpose', row.purpose, 'text_version', row.text_version, 'accepted_at', row.accepted_at);
end $$;
revoke all on function public.record_consent(text, text, text) from public, anon;
grant execute on function public.record_consent(text, text, text) to authenticated;

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth_required'; end if;
  return jsonb_build_object(
    'format', 'ment-export-1',
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = me),
    'skills', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.skills x where x.user_id = me),
    'career_history', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.career_history x where x.user_id = me),
    'profile_drafts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.profile_drafts x where x.user_id = me),
    'reflections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.reflection_logs x where x.user_id = me),
    'unavailable_periods', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.mentorship_unavailable_periods x where x.user_id = me),
    'connections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.connections x where me in (x.requester_id, x.addressee_id)),
    'sessions', (select coalesce(jsonb_agg(
        to_jsonb(s) - 'route_token' - (case when s.mentor_id = me
          then array['reflection', 'mentee_rating'] else array['mentor_reflection', 'mentor_rating'] end)
        order by s.id), '[]')
      from public.sessions s where me in (s.mentor_id, s.mentee_id)),
    'session_messages_sent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.session_messages x where x.sender_id = me),
    'groups_created', (select coalesce(jsonb_agg(to_jsonb(x) - 'route_token' order by x.id), '[]') from public.groups x where x.created_by = me),
    'group_memberships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_members x where x.user_id = me),
    'group_join_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_join_requests x where x.user_id = me),
    'group_messages_sent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.group_messages x where x.sender_id = me),
    'discovery_threads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from public.discovery_threads x where x.user_id = me),
    'discovery_feedback', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.discovery_feedback x where x.user_id = me),
    'feedback', (select coalesce(jsonb_agg(to_jsonb(x) - 'reviewed_by'), '[]') from public.feedback_messages x where x.user_id = me),
    'continuation_intents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.continuation_intents x where x.user_id = me),
    'outcome_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.outcome_events x where x.actor_id = me),
    'calendar_connections', (select coalesce(jsonb_agg(to_jsonb(x) - 'token_ciphertext' - 'refresh_ciphertext'), '[]') from public.calendar_connections x where x.user_id = me),
    'calendar_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.calendar_events x where x.owner_id = me),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.notification_outbox x where x.user_id = me),
    'consents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.accepted_at), '[]') from public.consent_records x where x.user_id = me)
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
