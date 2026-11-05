-- CV parsing is optional. Keep a dated withdrawal alongside the acceptance
-- record so a member can stop future parsing without deleting the account.
alter table public.consent_records
  add column if not exists withdrawn_at timestamptz;

create or replace function public.withdraw_cv_import_consent()
returns integer language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  changed integer;
begin
  if me is null then raise exception 'auth_required'; end if;
  update public.consent_records
    set withdrawn_at = now()
    where user_id = me and purpose = 'ai_profile_import' and withdrawn_at is null;
  get diagnostics changed = row_count;
  -- The source text and the model's draft are no longer needed once the
  -- member withdraws permission to process their uploaded CV.
  delete from public.profile_drafts where user_id = me and source = 'cv';
  return changed;
end $$;
revoke all on function public.withdraw_cv_import_consent() from public, anon;
grant execute on function public.withdraw_cv_import_consent() to authenticated;

notify pgrst, 'reload schema';
