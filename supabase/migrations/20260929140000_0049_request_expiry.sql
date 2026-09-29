-- Keep automated expiry distinct from a member cancelling a request.
alter table public.sessions add column if not exists expired_at timestamptz;

create or replace function public.expire_pending_requests()
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.sessions
  set status = 'cancelled', expired_at = now(), last_activity_at = now()
  where status = 'pending'
    and coalesce(request_expires_at, created_at + interval '7 days') <= now();
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.expire_pending_requests() from public, anon, authenticated;

create or replace function public.my_sessions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(
      public.session_payload(s, caller) || jsonb_build_object(
        'request_expires_at', s.request_expires_at,
        'expired_at', s.expired_at
      ) order by s.last_activity_at desc
    )
    from public.sessions s where caller in (s.mentor_id, s.mentee_id)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

create or replace function public.cancel_session(p_session_id bigint, p_status text default 'cancelled')
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); row public.sessions; was_pending boolean;
begin
  if p_status not in ('declined', 'cancelled') then raise exception 'invalid_status'; end if;
  select * into row from public.sessions where id = p_session_id for update;
  if row.id is null then raise exception 'session_not_found'; end if;
  if caller not in (row.mentor_id, row.mentee_id) then raise exception 'forbidden'; end if;
  if row.status not in ('pending', 'scheduled') then raise exception 'invalid_status'; end if;
  if row.status = 'pending' and coalesce(row.request_expires_at, row.created_at + interval '7 days') <= now() then
    raise exception 'request_expired';
  end if;
  if row.status = 'pending' and (
    (p_status = 'declined' and caller <> row.mentor_id) or
    (p_status = 'cancelled' and caller <> row.mentee_id)
  ) then raise exception 'forbidden'; end if;
  if row.status = 'scheduled' and p_status = 'declined' then raise exception 'invalid_status'; end if;
  was_pending := row.status = 'pending';
  update public.sessions set status = p_status, last_activity_at = now()
  where id = p_session_id returning * into row;
  insert into public.session_messages(session_id, sender_id, kind, body)
  values (p_session_id, caller, 'system', case
    when p_status = 'declined' then 'Request declined.'
    when was_pending then 'Request withdrawn.'
    else 'Meeting cancelled.' end);
  return public.session_payload(row, caller);
end;
$$;
revoke all on function public.cancel_session(bigint, text) from public, anon;
grant execute on function public.cancel_session(bigint, text) to authenticated;
