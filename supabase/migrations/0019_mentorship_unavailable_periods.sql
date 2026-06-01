-- 0019 Multi-period mentorship unavailability (P4)
--
-- 0010 added a single mentorship_unavailable_until date + a manual pause flag.
-- Real availability is lumpier than that (vacations, recurring OOO), so this
-- adds an explicit list of [start_date, end_date] unavailability windows. A
-- mentor counts as unavailable if paused, before the legacy unavailable_until,
-- OR if today falls inside any of these periods.

create table if not exists public.mentorship_unavailable_periods (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists mentorship_unavailable_periods_user_idx
  on public.mentorship_unavailable_periods (user_id, start_date, end_date);

alter table public.mentorship_unavailable_periods enable row level security;

-- Owner manages their own windows; nobody else can read or write them.
drop policy if exists mup_select_own on public.mentorship_unavailable_periods;
create policy mup_select_own on public.mentorship_unavailable_periods
  for select to authenticated using (user_id = auth.uid());

drop policy if exists mup_insert_own on public.mentorship_unavailable_periods;
create policy mup_insert_own on public.mentorship_unavailable_periods
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists mup_delete_own on public.mentorship_unavailable_periods;
create policy mup_delete_own on public.mentorship_unavailable_periods
  for delete to authenticated using (user_id = auth.uid());

-- Availability now also considers the period windows. Used by matching,
-- request_session and peer_profile (all call this function).
create or replace function public.is_currently_available_mentor(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    not p.mentorship_paused
    and (p.mentorship_unavailable_until is null
         or p.mentorship_unavailable_until <= current_date)
    and not exists (
      select 1 from public.mentorship_unavailable_periods up
      where up.user_id = p.id
        and current_date between up.start_date and up.end_date
    ),
    true
  )
  from public.profiles p
  where p.id = p_user_id
$$;

grant execute on function public.is_currently_available_mentor(uuid) to authenticated;
