-- Keep migration 0103's draft guard. Also serialize upload metadata writes
-- with withdrawal on the same active consent row. A write that wins the lock
-- commits before withdrawal returns; a write that loses cannot publish a CV.
-- Apply to service-role writes too (e.g. a previously authorized upload).
create or replace function public.require_active_cv_upload_consent()
returns trigger language plpgsql security definer set search_path = public as $$
declare active_consent_id bigint;
begin
  if new.bucket_id <> 'profile-uploads' then return new; end if;
  select id into active_consent_id
    from public.consent_records
    where user_id::text = split_part(new.name, '/', 1)
      and purpose = 'ai_profile_import' and withdrawn_at is null
    order by accepted_at desc, id desc
    limit 1 for update;
  if active_consent_id is null then raise exception 'cv_consent_required'; end if;
  return new;
end $$;
revoke all on function public.require_active_cv_upload_consent() from public, anon, authenticated;

create trigger cv_upload_consent_guard
  before insert or update on storage.objects
  for each row execute function public.require_active_cv_upload_consent();
