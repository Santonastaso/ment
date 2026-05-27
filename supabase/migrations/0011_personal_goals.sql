-- Soft self-imposed goal: number of mentoring sessions the user wants to
-- complete each month. Per PIT's feedback, we keep this light: a single
-- integer per user. The dashboard renders a nudge based on progress against
-- it ("you're one session away" etc.) instead of strict targets.

alter table public.profiles
  add column if not exists monthly_session_goal integer default 0
    check (monthly_session_goal >= 0 and monthly_session_goal <= 30);

-- Sessions completed in the current calendar month, viewer-only.
create or replace function public.my_monthly_completed_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.sessions s
  where (s.mentor_id = auth.uid() or s.mentee_id = auth.uid())
    and s.status = 'completed'
    and date_trunc('month', s.created_at) = date_trunc('month', now())
$$;

grant execute on function public.my_monthly_completed_count() to authenticated;
