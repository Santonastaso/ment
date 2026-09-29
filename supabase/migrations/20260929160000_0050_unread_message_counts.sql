-- Per-user read cursors for group threads and compact navigation unread counts.
create table if not exists public.group_reads (
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_reads enable row level security;
revoke all on public.group_reads from public, anon, authenticated;
grant all on public.group_reads to service_role;

-- Existing history is not a new notification: begin tracking at the latest
-- message so users only see messages that arrive after this migration.
insert into public.group_reads(group_id, user_id, last_read_at)
select gm.group_id, members.user_id, max(gm.created_at)
from public.group_messages gm
join public.group_members members on members.group_id = gm.group_id
group by gm.group_id, members.user_id
on conflict (group_id, user_id) do nothing;

create or replace function public.mark_group_read(p_group_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then raise exception 'not_a_member'; end if;

  insert into public.group_reads(group_id, user_id, last_read_at)
  values (p_group_id, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.my_unread_message_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'auth_required'; end if;
  return jsonb_build_object(
    'sessions', (
      select count(*)::integer from (
        select m.session_id
        from public.session_messages m
        join public.sessions s on s.id = m.session_id
        left join public.session_reads r on r.session_id = m.session_id and r.user_id = caller
        where caller in (s.mentor_id, s.mentee_id)
          and m.sender_id <> caller
          and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
        group by m.session_id
      ) unread
    ),
    'groups', (
      select count(*)::integer from (
        select m.group_id
        from public.group_messages m
        join public.group_members gm on gm.group_id = m.group_id and gm.user_id = caller
        left join public.group_reads r on r.group_id = m.group_id and r.user_id = caller
        where m.sender_id <> caller
          and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
        group by m.group_id
      ) unread
    )
  );
end;
$$;

revoke all on function public.mark_group_read(bigint), public.my_unread_message_counts() from public, anon;
grant execute on function public.mark_group_read(bigint), public.my_unread_message_counts() to authenticated;
