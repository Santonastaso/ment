-- Complete the client match contract and merge common duplicate skill labels.

do $migration$
declare
  v_original text;
  v_revised text;
begin
  select pg_get_functiondef('public.get_matches_for(text, integer, integer, boolean)'::regprocedure)
  into v_original;

  v_revised := replace(
    v_original,
    E'''seniority'', v_other.seniority,\n        ''job_title''',
    E'''seniority'', v_other.seniority,\n        ''role'', v_other.role,\n        ''job_title'''
  );

  if v_revised = v_original then
    -- The function was already patched (for example, after an interrupted push).
    if position(E'''role'', v_other.role' in v_original) > 0 then
      return;
    end if;
    raise exception 'get_matches_for payload shape changed; role migration needs review';
  end if;

  execute v_revised;
end;
$migration$;

update public.skills
set skill = 'communication'
where lower(trim(skill)) in ('effective communication', 'communicating');

delete from public.skills duplicate
using (
  select id,
         row_number() over (
           partition by user_id, type, lower(trim(skill))
           order by nullif(example_project, '') is null, id
         ) as position
  from public.skills
) ranked
where duplicate.id = ranked.id
  and ranked.position > 1;

create unique index if not exists skills_user_type_normalized_skill_key
  on public.skills (user_id, type, lower(trim(skill)));
