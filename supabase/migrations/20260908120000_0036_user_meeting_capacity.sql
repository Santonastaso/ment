-- User-owned mentoring capacity and booked-slot reporting.
alter table public.profiles
  add column if not exists weekly_meeting_limit integer not null default 2
    check (weekly_meeting_limit between 1 and 50),
  add column if not exists monthly_meeting_limit integer not null default 6
    check (monthly_meeting_limit between 1 and 200),
  add constraint profiles_capacity_limits_valid
    check (monthly_meeting_limit >= weekly_meeting_limit);

create or replace function public.my_meeting_capacity()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  weekly_limit integer;
  monthly_limit integer;
  weekly_booked integer;
  monthly_booked integer;
  week_start timestamptz := date_trunc('week', now());
  month_start timestamptz := date_trunc('month', now());
begin
  if caller is null then raise exception 'auth_required'; end if;

  select weekly_meeting_limit, monthly_meeting_limit
    into weekly_limit, monthly_limit
  from public.profiles where id = caller;

  select count(*) into weekly_booked
  from public.sessions
  where mentor_id = caller
    and status in ('scheduled', 'completed')
    and coalesce(scheduled_at, occurred_at) >= week_start
    and coalesce(scheduled_at, occurred_at) < week_start + interval '1 week';

  select count(*) into monthly_booked
  from public.sessions
  where mentor_id = caller
    and status in ('scheduled', 'completed')
    and coalesce(scheduled_at, occurred_at) >= month_start
    and coalesce(scheduled_at, occurred_at) < month_start + interval '1 month';

  return jsonb_build_object(
    'weekly_limit', weekly_limit,
    'monthly_limit', monthly_limit,
    'weekly_booked', weekly_booked,
    'monthly_booked', monthly_booked
  );
end;
$$;

revoke all on function public.my_meeting_capacity() from public, anon;
grant execute on function public.my_meeting_capacity() to authenticated;

create or replace function public.enforce_meeting_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  weekly_limit integer;
  monthly_limit integer;
  weekly_booked integer;
  monthly_booked integer;
  meeting_time timestamptz;
begin
  if new.status <> 'scheduled' or new.scheduled_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status and old.scheduled_at is not distinct from new.scheduled_at then return new; end if;

  meeting_time := new.scheduled_at;
  select weekly_meeting_limit, monthly_meeting_limit
    into weekly_limit, monthly_limit
  from public.profiles where id = new.mentor_id;

  select count(*) into weekly_booked
  from public.sessions s
  where s.mentor_id = new.mentor_id and s.id <> new.id
    and s.status in ('scheduled', 'completed')
    and coalesce(s.scheduled_at, s.occurred_at) >= date_trunc('week', meeting_time)
    and coalesce(s.scheduled_at, s.occurred_at) < date_trunc('week', meeting_time) + interval '1 week';

  select count(*) into monthly_booked
  from public.sessions s
  where s.mentor_id = new.mentor_id and s.id <> new.id
    and s.status in ('scheduled', 'completed')
    and coalesce(s.scheduled_at, s.occurred_at) >= date_trunc('month', meeting_time)
    and coalesce(s.scheduled_at, s.occurred_at) < date_trunc('month', meeting_time) + interval '1 month';

  if weekly_booked >= weekly_limit then raise exception 'weekly_capacity_reached'; end if;
  if monthly_booked >= monthly_limit then raise exception 'monthly_capacity_reached'; end if;
  return new;
end;
$$;

revoke all on function public.enforce_meeting_capacity() from public, anon, authenticated;
drop trigger if exists enforce_meeting_capacity on public.sessions;
create trigger enforce_meeting_capacity
before insert or update of status, scheduled_at on public.sessions
for each row execute function public.enforce_meeting_capacity();

