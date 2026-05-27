-- Mentee acknowledgement of accepted sessions.
--
-- When a mentor accepts a session the mentee should see a popup the next
-- time they land on the dashboard. We track that "I have seen this" event
-- on the session row so it survives across browsers/devices. The dashboard
-- nav badge counts unacknowledged scheduled sessions for the mentee.

alter table public.sessions
  add column if not exists mentee_acknowledged_at timestamptz;

create index if not exists sessions_mentee_pending_ack_idx
  on public.sessions (mentee_id)
  where status = 'scheduled' and mentee_acknowledged_at is null;

-- Backfill: any session that is already completed, cancelled, or whose
-- scheduled_at is in the past should NOT show up as pending acceptance. We
-- treat created_at as a safe acknowledgement timestamp for those rows so
-- the popup only ever fires for genuinely new, future-facing scheduling.
update public.sessions
   set mentee_acknowledged_at = coalesce(mentee_acknowledged_at, created_at)
 where mentee_acknowledged_at is null
   and (
        status in ('completed', 'cancelled')
     or (scheduled_at is not null and scheduled_at < now())
   );

-- Expose the new column to the session_payload jsonb so the client can
-- distinguish acknowledged vs pending rows without an extra round-trip.
create or replace function public.session_payload(p_session public.sessions, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'mentor_id', p_session.mentor_id,
    'mentee_id', p_session.mentee_id,
    'connection_id', p_session.connection_id,
    'title', p_session.title,
    'scheduled_at', p_session.scheduled_at,
    'duration_minutes', p_session.duration_minutes,
    'status', p_session.status,
    'pre_session_question', p_session.pre_session_question,
    'reflection', case when p_session.mentee_id = p_viewer then p_session.reflection else '' end,
    'mentor_reflection', case when p_session.mentor_id = p_viewer then p_session.mentor_reflection else '' end,
    'mentee_rating', case when p_session.mentee_id = p_viewer then p_session.mentee_rating else null end,
    'mentor_rating', case when p_session.mentor_id = p_viewer then p_session.mentor_rating else null end,
    'mentee_completed_at', p_session.mentee_completed_at,
    'mentor_completed_at', p_session.mentor_completed_at,
    'mentee_acknowledged_at', p_session.mentee_acknowledged_at,
    'topics', p_session.topics,
    'created_at', p_session.created_at
  );
$$;

-- Mark a session as acknowledged by its mentee. Idempotent. Only the
-- session's mentee can acknowledge it; cross-user calls are a no-op.
create or replace function public.acknowledge_session(p_session_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  update public.sessions
     set mentee_acknowledged_at = now()
   where id = p_session_id
     and mentee_id = v_caller
     and mentee_acknowledged_at is null;
end;
$$;

-- Sessions that are accepted by the mentor but not yet seen by the mentee.
-- Returns a jsonb array of session_payload objects.
create or replace function public.pending_acceptances()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(public.session_payload(s, v_caller)
                     order by s.scheduled_at nulls last, s.created_at)
    from public.sessions s
    where s.mentee_id = v_caller
      and s.status = 'scheduled'
      and s.mentee_acknowledged_at is null
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.acknowledge_session(bigint) to authenticated;
grant execute on function public.pending_acceptances() to authenticated;
