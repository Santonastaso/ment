-- The database cannot attest to an Edge Function's configuration or a
-- provider's physical region. Do not present constants as verified status.
create or replace function public.privacy_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_type text;
  v_min int;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if not public.is_admin(v_caller) then raise exception 'forbidden'; end if;
  select organization_id into v_org from public.profiles where id = v_caller;
  select coalesce(o.type, 'intra'), coalesce(o.min_team_dashboard_size, 3)
    into v_type, v_min from public.organizations o where o.id = v_org;

  return jsonb_build_object(
    'aiClassification', jsonb_build_object(
      'label', 'Provider configuration not verified here', 'enabled', null,
      'source', 'Check deployed Edge Function secrets and provider agreements'),
    'supabaseRegion', null,
    'peerVisibleFields', jsonb_build_array(
      'first name + last initial', 'role', 'department', 'location', 'bio', 'teachable skills'),
    'hiddenFields', jsonb_build_array(
      'reflections', 'ratings', 'wants-to-learn', 'shadow role',
      'shadow_role_response (column-locked)', 'session reflections/ratings (column-locked)'),
    'edgeFunctions', '[]'::jsonb,
    'orgType', v_type,
    'minTeamDashboardSize', v_min,
    'interExtraRedactions', case when v_type = 'inter'
      then jsonb_build_array('job_title', 'location') else '[]'::jsonb end
  );
end $$;
revoke all on function public.privacy_status() from public, anon;
grant execute on function public.privacy_status() to authenticated;

notify pgrst, 'reload schema';
