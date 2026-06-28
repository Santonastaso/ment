-- =====================================================================
-- ANDREA #2 — let an org-scoped admin REQUEST a tier change
-- (intra <-> inter) without giving them the ability to flip it directly.
-- Reuses the existing feedback_messages pipeline so platform admins
-- (Fra/Pit) pick up the request in their existing feedback queue.
-- =====================================================================

-- Extend the allowed categories on submit_feedback so org admins can file
-- a "tier_change" request alongside the existing general/bug/idea/question
-- ones. Identical structure otherwise.
create or replace function public.submit_feedback(
  p_category text,
  p_message text
)
returns public.feedback_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_row public.feedback_messages;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'message_required';
  end if;
  if char_length(p_message) > 2000 then
    raise exception 'message_too_long';
  end if;
  if p_category is null or p_category not in
       ('general', 'bug', 'idea', 'question', 'tier_change') then
    p_category := 'general';
  end if;
  select organization_id into v_org from public.profiles where id = v_caller;
  insert into public.feedback_messages (user_id, organization_id, category, message)
  values (v_caller, v_org, p_category, trim(p_message))
  returning * into v_row;
  return v_row;
end;
$$;

-- Convenience RPC the client calls from the privacy panel. Validates the
-- requested target type and writes a structured message so a platform admin
-- can act on it from their feedback queue without parsing free text.
create or replace function public.request_org_tier_change(
  p_requested_type text,
  p_note text default ''
)
returns public.feedback_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_current_type text;
  v_scope text;
  v_message text;
  v_row public.feedback_messages;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  v_scope := public.admin_scope_for(v_caller);
  if v_scope not in ('org', 'platform') then
    raise exception 'admin_only';
  end if;
  if p_requested_type not in ('intra', 'inter') then
    raise exception 'invalid_type';
  end if;
  select organization_id into v_org from public.profiles where id = v_caller;
  if v_org is null then raise exception 'no_org'; end if;
  select coalesce(o.type, 'intra') into v_current_type
    from public.organizations o where o.id = v_org;
  if v_current_type = p_requested_type then
    raise exception 'already_current_type';
  end if;

  v_message := format(
    'Org tier change request: %s -> %s. Note: %s',
    v_current_type, p_requested_type,
    coalesce(nullif(trim(p_note), ''), '(no note provided)')
  );

  insert into public.feedback_messages (user_id, organization_id, category, message)
  values (v_caller, v_org, 'tier_change', v_message)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.request_org_tier_change(text, text) from public;
grant execute on function public.request_org_tier_change(text, text) to authenticated;
