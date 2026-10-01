-- Matching and directory browsing must use the same capacity and absence rules.
create or replace function public.available_discovery_profiles(p_organization_id uuid, p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(p.id), '[]'::jsonb)
  from public.profiles p
  where p.organization_id = p_organization_id and p.id = any(p_ids)
    and p.admin_scope = 'none' and p.onboarding_complete and p.deactivated_at is null
    and public.is_currently_available_mentor(p.id)
$$;
revoke all on function public.available_discovery_profiles(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.available_discovery_profiles(uuid, uuid[]) to service_role;

create or replace function public.my_meeting_capacity()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not public.is_active_user() then raise exception 'not_allowed'; end if;
  select jsonb_build_object(
    'weekly_limit', p.weekly_meeting_limit, 'monthly_limit', p.monthly_meeting_limit,
    'weekly_booked', count(s.id) filter (where
      case when s.status = 'pending' then s.created_at else s.accepted_at end >= date_trunc('week', now())),
    'monthly_booked', count(s.id) filter (where
      case when s.status = 'pending' then s.created_at else s.accepted_at end >= date_trunc('month', now())),
    'available', public.is_currently_available_mentor(p.id)
  ) into result
  from public.profiles p left join public.sessions s
    on s.mentor_id = p.id and public.is_active_connection(s)
  where p.id = auth.uid()
  group by p.id;
  return result;
end;
$$;
revoke all on function public.my_meeting_capacity() from public, anon;
grant execute on function public.my_meeting_capacity() to authenticated;
notify pgrst, 'reload schema';
