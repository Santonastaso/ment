-- User-submitted help/feedback messages.
--
-- Backs the "Help & Feedback" item in the profile dropdown. Any signed-in
-- user can submit a message; org admins (and platform admins) can list
-- messages from their org through a security-definer RPC.

create table if not exists public.feedback_messages (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  category text not null default 'general'
    check (category in ('general', 'bug', 'idea', 'question')),
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'resolved')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_messages_org_status_idx
  on public.feedback_messages (organization_id, status, created_at desc);
create index if not exists feedback_messages_user_idx
  on public.feedback_messages (user_id, created_at desc);

alter table public.feedback_messages enable row level security;

-- Submit: the authenticated user can insert their own row only. We always
-- snapshot the organization at submit time from the user's profile.
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
  if p_category is null or p_category not in ('general', 'bug', 'idea', 'question') then
    p_category := 'general';
  end if;
  select organization_id into v_org from public.profiles where id = v_caller;
  insert into public.feedback_messages (user_id, organization_id, category, message)
  values (v_caller, v_org, p_category, trim(p_message))
  returning * into v_row;
  return v_row;
end;
$$;

-- List feedback for review. Org admins see their org's messages; platform
-- admins see everything. Returns enriched rows with the submitter's
-- redacted name + email (admin scope can see emails for follow-up).
create or replace function public.list_feedback(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_scope text;
  v_org uuid;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  v_scope := public.admin_scope_for(v_caller);
  if v_scope not in ('org', 'platform') then
    raise exception 'forbidden';
  end if;
  select organization_id into v_org from public.profiles where id = v_caller;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'category', f.category,
      'message', f.message,
      'status', f.status,
      'created_at', f.created_at,
      'reviewed_at', f.reviewed_at,
      'organization_id', f.organization_id,
      'user', jsonb_build_object(
        'id', f.user_id,
        'name', p.name,
        'department', p.department
      )
    ) order by f.created_at desc)
    from public.feedback_messages f
    left join public.profiles p on p.id = f.user_id
    where (v_scope = 'platform' or f.organization_id = v_org)
      and (p_status is null or f.status = p_status)
  ), '[]'::jsonb);
end;
$$;

-- Mark a feedback message as reviewing / resolved.
create or replace function public.update_feedback_status(
  p_id bigint,
  p_status text
)
returns public.feedback_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_scope text;
  v_org uuid;
  v_row public.feedback_messages;
begin
  if v_caller is null then raise exception 'auth_required'; end if;
  v_scope := public.admin_scope_for(v_caller);
  if v_scope not in ('org', 'platform') then
    raise exception 'forbidden';
  end if;
  if p_status not in ('new', 'reviewing', 'resolved') then
    raise exception 'invalid_status';
  end if;
  select organization_id into v_org from public.profiles where id = v_caller;
  update public.feedback_messages f
     set status = p_status,
         reviewed_at = case when p_status = 'new' then null else now() end,
         reviewed_by = case when p_status = 'new' then null else v_caller end
   where f.id = p_id
     and (v_scope = 'platform' or f.organization_id = v_org)
  returning * into v_row;
  if v_row.id is null then raise exception 'not_found'; end if;
  return v_row;
end;
$$;

grant execute on function public.submit_feedback(text, text) to authenticated;
grant execute on function public.list_feedback(text) to authenticated;
grant execute on function public.update_feedback_status(bigint, text) to authenticated;
