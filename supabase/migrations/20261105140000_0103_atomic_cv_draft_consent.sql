-- Serialize CV draft creation with consent withdrawal. The trigger locks the
-- active consent row until the draft statement commits; withdrawal updates the
-- same row before it deletes drafts. Whichever transaction finishes second
-- therefore observes the first one's result.
create or replace function public.require_active_cv_draft_consent()
returns trigger language plpgsql security definer set search_path = public as $$
declare active_consent_id bigint;
begin
  if new.source <> 'cv' then return new; end if;
  select id into active_consent_id
    from public.consent_records
    where user_id = new.user_id and purpose = 'ai_profile_import' and withdrawn_at is null
    order by accepted_at desc, id desc
    limit 1 for update;
  if active_consent_id is null then raise exception 'cv_consent_required'; end if;
  return new;
end $$;
revoke all on function public.require_active_cv_draft_consent() from public, anon, authenticated;

create trigger cv_draft_consent_guard
  before insert or update of source on public.profile_drafts
  for each row execute function public.require_active_cv_draft_consent();
