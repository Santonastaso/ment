-- Existing members can review the same published Terms/Privacy version as new
-- members. Replays from multiple tabs preserve the first acknowledgement.
-- Optional CV permission remains a separate, renewable record.
create or replace function public.record_consent(p_purpose text, p_text_version text, p_locale text default 'en')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); row public.consent_records;
begin
  if me is null then raise exception 'auth_required'; end if;
  -- A still-valid JWT must not recreate consent after account erasure.
  perform id from public.profiles
    where id = me and deactivated_at is null and erased_at is null for update;
  if not found then raise exception 'account_deactivated'; end if;
  if p_purpose = 'terms_privacy' then
    select * into row from public.consent_records
      where user_id = me and purpose = p_purpose and text_version = p_text_version
      order by accepted_at, id limit 1;
  end if;
  if row.id is null then
    insert into public.consent_records (user_id, purpose, text_version, locale)
      values (me, p_purpose, p_text_version, coalesce(nullif(p_locale, ''), 'en'))
      returning * into row;
  end if;
  return jsonb_build_object('purpose', row.purpose, 'text_version', row.text_version, 'accepted_at', row.accepted_at);
end $$;
revoke all on function public.record_consent(text, text, text) from public, anon;
grant execute on function public.record_consent(text, text, text) to authenticated;

notify pgrst, 'reload schema';
