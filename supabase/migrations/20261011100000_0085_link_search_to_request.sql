-- A saved search records the request it produced.
--
-- The Home chat used to decide whether a reopened search had been "sent" by
-- looking for any open request with the same person. That guess shows an
-- unsent draft as sent whenever another request with that person exists. The
-- link is now stored, and it is written here, in the same transaction that
-- creates the request, so a request can never exist without its link.

alter table public.discovery_threads
  add column session_id bigint references public.sessions(id) on delete set null;

-- Owners may still create and edit their searches, but the link is not theirs
-- to write, on insert or on update: only request_conversation sets it.
revoke insert, update on public.discovery_threads from authenticated;
grant insert (user_id, title, intent, turns, selected_person_id, archived)
  on public.discovery_threads to authenticated;
grant update (title, intent, turns, selected_person_id, archived, updated_at)
  on public.discovery_threads to authenticated;

-- One more parameter means a new signature. The old one is dropped so that a
-- call without p_thread_id resolves to exactly one function; the default keeps
-- every existing caller (request modal, older clients) working unchanged.
drop function public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text);

create function public.request_conversation(
  p_mentor_id uuid, p_title text, p_message text,
  p_scheduled_at timestamptz default null, p_duration_minutes integer default 60,
  p_pre_session_question text default '', p_topics jsonb default null,
  p_idempotency_key uuid default null, p_follow_up_intent text default 'one_off',
  p_thread_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; existing public.sessions; caller uuid := auth.uid();
  normalized_topics jsonb := coalesce(p_topics, '[]'::jsonb);
  linked bigint; request_id bigint;
begin
  if not public.is_active_user() then raise exception 'not_allowed'; end if;
  if caller is null then raise exception 'auth_required'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required'; end if;
  if length(trim(coalesce(p_message, ''))) not between 1 and 6000 then raise exception 'invalid_message'; end if;
  if jsonb_typeof(normalized_topics) <> 'array' then normalized_topics := '[]'::jsonb; end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text || p_idempotency_key::text, 0));

  -- The search must be the caller's own. Its row stays locked until commit, so
  -- two sends from two tabs cannot both link it.
  if p_thread_id is not null then
    select t.session_id into linked from public.discovery_threads t
      where t.id = p_thread_id and t.user_id = caller for update;
    if not found then raise exception 'thread_not_found'; end if;
  end if;

  select * into existing from public.sessions
    where mentee_id = caller and idempotency_key = p_idempotency_key;
  if found then
    if existing.mentor_id is distinct from p_mentor_id
      or existing.title is distinct from trim(p_title)
      or existing.outbound_message is distinct from trim(p_message)
      or existing.scheduled_at is distinct from p_scheduled_at
      or existing.duration_minutes is distinct from least(greatest(coalesce(p_duration_minutes, 60), 15), 240)
      or existing.pre_session_question is distinct from coalesce(p_pre_session_question, '')
      or existing.topics is distinct from normalized_topics
      or existing.follow_up_intent is distinct from p_follow_up_intent then
      raise exception 'idempotency_conflict';
    end if;
    result := public.session_payload(existing, caller);
  else
    -- A search that already produced a request cannot produce another.
    if linked is not null then raise exception 'thread_already_linked'; end if;
    result := public.pm_request_session(p_mentor_id, p_title, p_scheduled_at, p_duration_minutes,
      p_pre_session_question, normalized_topics, p_idempotency_key, p_follow_up_intent);
    perform public.pm_set_outbound_message((result->>'id')::bigint, p_message);
  end if;

  if p_thread_id is not null then
    request_id := (result->>'id')::bigint;
    -- A replay may repair a missing link; it may never replace a different one.
    if linked is not null and linked <> request_id then raise exception 'thread_already_linked'; end if;
    update public.discovery_threads
      set session_id = request_id, selected_person_id = p_mentor_id, archived = true, updated_at = now()
      where id = p_thread_id;
  end if;
  return result;
end;
$$;
revoke all on function public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text, uuid) from public, anon;
grant execute on function public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';
