-- Retention must not erase profiles until the Edge Function has removed the
-- corresponding private Storage objects. Split account erasure into a
-- candidate read and a revalidated, service-role-only finalization step.

create table public.account_erasure_auth_cleanup (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  queued_at timestamptz not null default now()
);
alter table public.account_erasure_auth_cleanup enable row level security;
revoke all on public.account_erasure_auth_cleanup from public, anon, authenticated;

create or replace function public.queue_erased_account_auth_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.erased_at is null and new.erased_at is not null then
    insert into public.account_erasure_auth_cleanup(user_id) values (new.id)
      on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_erased_account_auth_cleanup() from public, anon, authenticated;

drop trigger if exists queue_erased_account_auth_cleanup on public.profiles;
create trigger queue_erased_account_auth_cleanup
  after update of erased_at on public.profiles
  for each row execute function public.queue_erased_account_auth_cleanup();

-- Keep any accounts erased before this migration eligible for an Auth cleanup retry.
insert into public.account_erasure_auth_cleanup(user_id)
  select id from public.profiles where erased_at is not null
  on conflict (user_id) do nothing;

create or replace function public.run_data_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.retention_settings; n integer;
  messages integer := 0; sessions_cleared integer := 0; searches integer := 0;
  reflections integer := 0; audit integer := 0;
begin
  for s in select * from public.retention_settings loop
    if s.conversation_days is not null then
      delete from public.session_messages m using public.sessions x, public.profiles p
        where m.session_id = x.id and p.id = x.mentor_id and p.organization_id = s.organization_id
          and m.created_at < now() - make_interval(days => s.conversation_days);
      get diagnostics n = row_count; messages := messages + n;
      delete from public.group_messages m using public.groups g
        where m.group_id = g.id and g.organization_id = s.organization_id
          and m.created_at < now() - make_interval(days => s.conversation_days);
      get diagnostics n = row_count; messages := messages + n;
      update public.sessions x set outbound_message = '', pre_session_question = '', reflection = '', mentor_reflection = ''
        from public.profiles p
        where p.id = x.mentor_id and p.organization_id = s.organization_id
          and x.status not in ('pending', 'scheduled')
          and x.last_activity_at < now() - make_interval(days => s.conversation_days)
          and (coalesce(x.outbound_message, '') <> '' or x.pre_session_question <> '' or x.reflection <> '' or x.mentor_reflection <> '');
      get diagnostics n = row_count; sessions_cleared := sessions_cleared + n;
    end if;
    if s.search_days is not null then
      delete from public.discovery_threads t using public.profiles p
        where p.id = t.user_id and p.organization_id = s.organization_id
          and t.updated_at < now() - make_interval(days => s.search_days);
      get diagnostics n = row_count; searches := searches + n;
    end if;
    if s.reflection_days is not null then
      delete from public.reflection_logs r using public.profiles p
        where p.id = r.user_id and p.organization_id = s.organization_id
          and r.created_at < now() - make_interval(days => s.reflection_days);
      get diagnostics n = row_count; reflections := reflections + n;
    end if;
    if s.audit_log_days is not null then
      delete from public.audit_logs a using public.profiles p
        where p.id = a.actor_id and p.organization_id = s.organization_id
          and a.created_at < now() - make_interval(days => s.audit_log_days);
      get diagnostics n = row_count; audit := audit + n;
    end if;
  end loop;
  return jsonb_build_object('messages', messages, 'sessions_cleared', sessions_cleared, 'searches', searches,
    'reflections', reflections, 'audit_logs', audit, 'erased_user_ids', '[]'::jsonb);
end $$;
revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;

create or replace function public.retention_account_candidates()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  from public.profiles p
  join public.retention_settings r on r.organization_id = p.organization_id
  where r.deactivated_account_days is not null
    and p.admin_scope = 'none' and not p.is_admin and p.erased_at is null
    and p.deactivated_at < now() - make_interval(days => r.deactivated_account_days)
$$;
revoke all on function public.retention_account_candidates() from public, anon, authenticated;
grant execute on function public.retention_account_candidates() to service_role;

create or replace function public.run_retention_account_erasure(p_candidates uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare member uuid; erased uuid[] := '{}';
begin
  if p_candidates is null or cardinality(p_candidates) = 0 then return erased; end if;
  for member in
    select p.id
    from public.profiles p
    join public.retention_settings r on r.organization_id = p.organization_id
    where p.id = any(p_candidates)
      and r.deactivated_account_days is not null
      and p.admin_scope = 'none' and not p.is_admin and p.erased_at is null
      and p.deactivated_at < now() - make_interval(days => r.deactivated_account_days)
    order by p.id
    for update of p
  loop
    perform public.erase_account_data(member);
    erased := erased || member;
  end loop;
  return erased;
end $$;
revoke all on function public.run_retention_account_erasure(uuid[]) from public, anon, authenticated;
grant execute on function public.run_retention_account_erasure(uuid[]) to service_role;

create or replace function public.retention_auth_cleanup_candidates()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
  from public.account_erasure_auth_cleanup
$$;
revoke all on function public.retention_auth_cleanup_candidates() from public, anon, authenticated;
grant execute on function public.retention_auth_cleanup_candidates() to service_role;

create or replace function public.complete_account_auth_cleanup(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.account_erasure_auth_cleanup where user_id = p_user_id;
  get diagnostics removed = row_count;
  return removed > 0;
end $$;
revoke all on function public.complete_account_auth_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.complete_account_auth_cleanup(uuid) to service_role;

notify pgrst, 'reload schema';
