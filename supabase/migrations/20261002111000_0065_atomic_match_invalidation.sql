create function public.profile_match_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.name is distinct from old.name
    or new.department is distinct from old.department
    or new.seniority is distinct from old.seniority
    or new.job_title is distinct from old.job_title
    or new.bio is distinct from old.bio
    or new.program is distinct from old.program
    or new.cohort_year is distinct from old.cohort_year
    or new.location is distinct from old.location
    or new.working_language is distinct from old.working_language then
    new.matches_stale := true;
  end if;
  return new;
end;
$$;

create trigger profile_match_change
before update on public.profiles
for each row execute function public.profile_match_change();

create function public.member_evidence_match_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update public.profiles set matches_stale = true where id = old.user_id;
    return null;
  end if;
  update public.profiles set matches_stale = true where id = new.user_id;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    update public.profiles set matches_stale = true where id = old.user_id;
  end if;
  return null;
end;
$$;

create trigger skill_match_change
after insert or update or delete on public.skills
for each row execute function public.member_evidence_match_change();

create trigger career_match_change
after insert or update or delete on public.career_history
for each row execute function public.member_evidence_match_change();
