create function public.process_stale_matches_for(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; done uuid[] := '{}'; failed uuid[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 250 then raise exception 'batch_too_large'; end if;
  for v_id in select distinct unnest(p_ids) loop
    if not exists (select 1 from public.profiles
      where id = v_id and matches_stale and deactivated_at is null and admin_scope = 'none') then
      continue;
    end if;
    begin
      perform public._recompute_matches_for(v_id);
      update public.profiles set matches_stale = false where id = v_id;
      done := array_append(done, v_id);
    exception when others then
      failed := array_append(failed, v_id);
    end;
  end loop;
  return jsonb_build_object('processed', done, 'failed', failed);
end;
$$;
revoke all on function public.process_stale_matches_for(uuid[]) from public, anon, authenticated;
grant execute on function public.process_stale_matches_for(uuid[]) to service_role;
