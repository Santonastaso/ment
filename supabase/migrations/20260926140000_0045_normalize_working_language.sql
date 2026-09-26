-- profiles.working_language is free text with no constraint, and imports have
-- written both ISO codes and spelled-out names for the same language. The
-- Explorer facet is `select distinct working_language`, so the filter lists
-- "English" twice — once for 'en' and once for 'English' — and each entry
-- matches only half the members, because directory_browse compares the column
-- with plain equality.
--
-- Fold the spellings onto ISO 639-1 codes and keep them that way on write.

create or replace function public.normalize_working_language(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_value, '')))
    when ''           then 'en'
    -- English
    when 'english'    then 'en'
    when 'inglese'    then 'en'
    when 'anglais'    then 'en'
    -- French
    when 'french'     then 'fr'
    when 'francese'   then 'fr'
    when 'français'   then 'fr'
    when 'francais'   then 'fr'
    -- German
    when 'german'     then 'de'
    when 'tedesco'    then 'de'
    when 'allemand'   then 'de'
    when 'deutsch'    then 'de'
    -- Italian
    when 'italian'    then 'it'
    when 'italiano'   then 'it'
    when 'italien'    then 'it'
    -- Spanish
    when 'spanish'    then 'es'
    when 'spagnolo'   then 'es'
    when 'espagnol'   then 'es'
    when 'español'    then 'es'
    when 'espanol'    then 'es'
    -- Portuguese
    when 'portuguese' then 'pt'
    when 'portoghese' then 'pt'
    when 'portugais'  then 'pt'
    when 'português'  then 'pt'
    when 'portugues'  then 'pt'
    -- Dutch
    when 'dutch'      then 'nl'
    when 'olandese'   then 'nl'
    when 'neerlandais' then 'nl'
    when 'nederlands' then 'nl'
    -- Anything else keeps its value, trimmed and lower-cased, so an
    -- unrecognised language is tidied rather than discarded.
    else lower(btrim(p_value))
  end;
$$;

revoke all on function public.normalize_working_language(text) from public;

-- Backfill. `is distinct from` leaves already-normalised rows untouched, so
-- this is safe to re-run.
update public.profiles
set working_language = public.normalize_working_language(working_language)
where working_language is distinct from public.normalize_working_language(working_language);

-- Keep future imports clean: nothing in the application writes this column
-- today, so a trigger is the only place that covers every writer.
create or replace function public.profiles_normalize_working_language()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.working_language := public.normalize_working_language(new.working_language);
  return new;
end;
$$;

revoke all on function public.profiles_normalize_working_language() from public;

drop trigger if exists trg_profiles_normalize_working_language on public.profiles;
create trigger trg_profiles_normalize_working_language
  before insert or update of working_language on public.profiles
  for each row execute function public.profiles_normalize_working_language();
