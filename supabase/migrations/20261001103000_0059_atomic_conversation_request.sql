-- A sent request and its opening message are one transaction, including retries.
create or replace function public.pm_request_session(
  p_mentor_id uuid, p_title text, p_scheduled_at timestamptz default null,
  p_duration_minutes integer default 60, p_pre_session_question text default '',
  p_topics jsonb default null, p_idempotency_key uuid default null,
  p_follow_up_intent text default 'one_off'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; existing public.sessions; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required'; end if;
  if p_follow_up_intent not in ('one_off','ongoing') then raise exception 'invalid_intent'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || p_idempotency_key::text, 0));
  select * into existing from public.sessions where mentee_id = caller and idempotency_key = p_idempotency_key;
  if found then
    if existing.mentor_id <> p_mentor_id then raise exception 'idempotency_conflict'; end if;
    return public.session_payload(existing, caller);
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then raise exception 'invalid_schedule'; end if;
  if char_length(trim(coalesce(p_pre_session_question, ''))) not between 1 and 6000 then raise exception 'question_required'; end if;
  result := public.request_session(p_mentor_id, p_title, p_scheduled_at, p_duration_minutes, p_pre_session_question, p_topics);
  update public.sessions set idempotency_key = p_idempotency_key, follow_up_intent = p_follow_up_intent
    where id = (result->>'id')::bigint;
  return result;
end;
$$;

create function public.request_conversation(
  p_mentor_id uuid, p_title text, p_message text,
  p_scheduled_at timestamptz default null, p_duration_minutes integer default 60,
  p_pre_session_question text default '', p_topics jsonb default null,
  p_idempotency_key uuid default null, p_follow_up_intent text default 'one_off'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_active_user() then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_message, ''))) not between 1 and 6000 then raise exception 'invalid_message'; end if;
  result := public.pm_request_session(p_mentor_id, p_title, p_scheduled_at, p_duration_minutes,
    p_pre_session_question, p_topics, p_idempotency_key, p_follow_up_intent);
  perform public.pm_set_outbound_message((result->>'id')::bigint, p_message);
  return result;
end;
$$;
revoke all on function public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text) from public, anon;
grant execute on function public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text) to authenticated;
notify pgrst, 'reload schema';
