-- A retry must return the original request, not rewrite its message or activity.
create or replace function public.request_conversation(
  p_mentor_id uuid, p_title text, p_message text,
  p_scheduled_at timestamptz default null, p_duration_minutes integer default 60,
  p_pre_session_question text default '', p_topics jsonb default null,
  p_idempotency_key uuid default null, p_follow_up_intent text default 'one_off'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; existing public.sessions; caller uuid := auth.uid();
  normalized_topics jsonb := coalesce(p_topics, '[]'::jsonb);
begin
  if not public.is_active_user() then raise exception 'not_allowed'; end if;
  if caller is null then raise exception 'auth_required'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required'; end if;
  if length(trim(coalesce(p_message, ''))) not between 1 and 6000 then raise exception 'invalid_message'; end if;
  if jsonb_typeof(normalized_topics) <> 'array' then normalized_topics := '[]'::jsonb; end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text || p_idempotency_key::text, 0));
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
    return public.session_payload(existing, caller);
  end if;

  result := public.pm_request_session(p_mentor_id, p_title, p_scheduled_at, p_duration_minutes,
    p_pre_session_question, normalized_topics, p_idempotency_key, p_follow_up_intent);
  perform public.pm_set_outbound_message((result->>'id')::bigint, p_message);
  return result;
end;
$$;
