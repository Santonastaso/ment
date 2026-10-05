-- SECURITY DEFINER RPCs bypass table RLS, so preserve the active-account
-- invariant for routines introduced after the original guard migration.
do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_guarded text;
  v_count integer := 0;
begin
  foreach v_signature in array array[
    'public.save_onboarding(text,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,integer,text)'::regprocedure,
    'public.my_group_messages(bigint,integer,bigint)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_signature);
    v_guarded := regexp_replace(
      v_definition,
      'BEGIN',
      E'BEGIN\n  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN RAISE EXCEPTION ''account_deactivated''; END IF;',
      'i'
    );
    if v_guarded = v_definition then
      raise exception 'active_account_guard_not_added: %', v_signature;
    end if;
    execute v_guarded;
    v_count := v_count + 1;
  end loop;

  if v_count <> 2 then raise exception 'active_account_guard_count_mismatch'; end if;
end;
$$;

notify pgrst, 'reload schema';
