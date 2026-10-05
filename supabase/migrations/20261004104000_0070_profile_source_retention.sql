-- Existing drafts remain untouched until their historical retention is approved.
alter table public.profile_drafts add column raw_text_expires_at timestamptz;
alter table public.profile_drafts alter column raw_text_expires_at
  set default (now() + interval '30 days');
create index profile_drafts_raw_text_expiry on public.profile_drafts(raw_text_expires_at)
  where raw_text is not null and raw_text_expires_at is not null;

create function public.lock_profile_source_expiry()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.raw_text_expires_at := now() + interval '30 days';
  else
    new.created_at := old.created_at;
    new.raw_text_expires_at := old.raw_text_expires_at;
  end if;
  return new;
end;
$$;
create trigger profile_source_expiry
before insert or update on public.profile_drafts
for each row execute function public.lock_profile_source_expiry();

create function public.purge_expired_profile_source_text()
returns integer language plpgsql security definer set search_path = public as $$
declare purged integer;
begin
  update public.profile_drafts set raw_text = null
  where raw_text is not null and raw_text_expires_at <= now();
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke all on function public.purge_expired_profile_source_text() from public, anon, authenticated;
grant execute on function public.purge_expired_profile_source_text() to service_role;

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'mt-profile-source-retention';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  perform cron.schedule('mt-profile-source-retention', '23 3 * * *',
    'select public.purge_expired_profile_source_text()');
exception when undefined_table or undefined_function or invalid_schema_name then
  null;
end;
$$;
