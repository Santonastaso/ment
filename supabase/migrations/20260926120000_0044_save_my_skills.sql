-- Recovered from production on 2026-09-26.
--
-- Applied directly to the database on 2026-09-26 and never committed. The SQL
-- below is the exact text stored in supabase_migrations.schema_migrations for
-- version 20260926120000; create or replace plus the grants are idempotent.
--
-- What it does: replaces one of a user's two skill sets in a single
-- transaction. Takes a row lock on the profile so concurrent saves serialize,
-- enforces the 80-character evidence cap server-side rather than trusting the
-- client, deletes whatever is no longer in the payload, and marks the user's
-- matches stale when anything actually changed.

create or replace function public.save_my_skills(p_type text, p_skills jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item jsonb;
  skill_id bigint;
  kept_ids bigint[] := '{}';
  skill_name text;
  example text;
  old_example text;
  changed boolean := false;
  removed integer;
begin
  if caller is null then raise exception 'auth_required'; end if;
  if p_type not in ('can_teach', 'wants_to_learn') or jsonb_typeof(p_skills) is distinct from 'array' then
    raise exception 'invalid_skills';
  end if;

  -- Serialize concurrent saves for the same user before replacing this skill set.
  perform 1 from public.profiles where id = caller for update;
  if not found then raise exception 'not_found'; end if;

  for item in select value from jsonb_array_elements(p_skills) loop
    skill_id := nullif(item->>'id', '')::bigint;
    skill_name := btrim(coalesce(item->>'skill', ''));
    example := case when p_type = 'can_teach' then btrim(coalesce(item->>'example_project', '')) else '' end;
    if skill_name = '' or (skill_id is not null and skill_id = any(kept_ids)) then
      raise exception 'invalid_skill';
    end if;

    if skill_id is null then
      if length(example) > 80 then raise exception 'evidence_too_long'; end if;
      insert into public.skills(user_id, skill, type, example_project)
      values (caller, skill_name, p_type, example) returning id into skill_id;
      changed := true;
    else
      select example_project into old_example from public.skills
      where id = skill_id and user_id = caller and type = p_type;
      if not found then raise exception 'invalid_skill'; end if;
      if p_type = 'can_teach' and example is distinct from old_example then
        if length(example) > 80 then raise exception 'evidence_too_long'; end if;
        update public.skills set example_project = example where id = skill_id;
        changed := true;
      end if;
    end if;
    kept_ids := array_append(kept_ids, skill_id);
  end loop;

  delete from public.skills
  where user_id = caller and type = p_type and not (id = any(kept_ids));
  get diagnostics removed = row_count;
  if changed or removed > 0 then perform public.mark_matches_stale(caller); end if;
end;
$$;

revoke all on function public.save_my_skills(text, jsonb) from public, anon;

grant execute on function public.save_my_skills(text, jsonb) to authenticated;
