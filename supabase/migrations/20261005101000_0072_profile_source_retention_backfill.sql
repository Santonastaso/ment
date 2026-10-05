-- Give pre-existing source text the same 30-day lifetime as new uploads.
create or replace function public.lock_profile_source_expiry()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.raw_text_expires_at := now() + interval '30 days';
  else
    new.created_at := old.created_at;
    new.raw_text_expires_at := old.raw_text_expires_at;
    if new.raw_text_expires_at is null and new.raw_text is not null then
      new.raw_text_expires_at := case
        when old.raw_text is null then now() + interval '30 days'
        else old.created_at + interval '30 days'
      end;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mt-profile-source-retention') then
    raise exception 'profile_source_retention_schedule_missing';
  end if;
exception
  when undefined_table or invalid_schema_name then
    raise exception 'profile_source_retention_cron_unavailable';
end;
$$;

update public.profile_drafts
set raw_text_expires_at = created_at + interval '30 days'
where raw_text is not null and raw_text_expires_at is null;
