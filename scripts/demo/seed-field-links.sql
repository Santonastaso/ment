-- Demo data for the knowledge graph's "Links between fields" view.
--
-- A link between two fields of study is drawn once at least five different
-- people from those two fields have completed a meeting together (migration
-- 0090). The demo organisation's 52 sessions are spread too thinly for any
-- pair to reach five, so the view is empty.
--
-- This adds completed meetings between demo accounts only: members of the
-- "ment-demo" organisation whose login ends in @ment.invalid or
-- @dummy.ment.io. Real accounts are never touched. For each of the eight
-- largest fields it pairs the field with the next two, and for each pair adds
-- three meetings with different people on each side, so every pair has six
-- participants. Every meeting is titled "[Demo] ...", dated two weeks to four
-- months ago, and sends no email. Running it twice adds nothing the second
-- time. Remove everything it added with scripts/demo/remove-field-links.sql.
--
-- Run it in the Supabase SQL editor of the project that holds the demo data.

do $$
declare
  demo_org uuid := (select id from public.organizations where slug = 'ment-demo');
  fields text[];
  field_a text; field_b text;
  i integer; k integer; made integer; added integer := 0;
  pair record;
  topic text; started timestamptz;
begin
  if demo_org is null then raise exception 'The ment-demo organisation was not found.'; end if;
  if exists (select 1 from public.sessions where title like '[Demo] %') then
    raise notice 'Demo meetings are already there; nothing added.';
    return;
  end if;

  create temporary table demo_people on commit drop as
    select p.id, p.role, trim(p.department) field
    from public.profiles p join auth.users u on u.id = p.id
    where p.organization_id = demo_org and p.admin_scope = 'none' and p.deactivated_at is null
      and p.onboarding_complete and coalesce(trim(p.department), '') <> ''
      and (u.email like '%@ment.invalid' or u.email like '%@dummy.ment.io');

  select array_agg(field order by n desc, field) into fields
  from (select field, count(*) n from demo_people group by field having count(*) >= 6
        order by count(*) desc, field limit 8) largest;
  if coalesce(array_length(fields, 1), 0) < 3 then raise exception 'Not enough demo fields of study to link.'; end if;

  for i in 1 .. array_length(fields, 1) loop
    for k in 1 .. 2 loop
      field_a := fields[i];
      field_b := fields[((i - 1 + k) % array_length(fields, 1)) + 1];
      -- Three meetings: alumni (or anyone) of field A meet students (or anyone)
      -- of field B, a different person on each side every time. The request
      -- guard can refuse someone (open requests, a live meeting with the same
      -- person); they are skipped and the next people are tried.
      made := 0;
      for pair in
        select m.id mentor_id, s.id mentee_id from (
          select id, row_number() over (order by role <> 'alumnus', md5(id::text || field_b)) n
          from demo_people where field = field_a and public.is_currently_available_mentor(id)
        ) m join (
          select id, row_number() over (order by role <> 'student', md5(id::text || field_a)) n
          from demo_people where field = field_b
        ) s on s.n = m.n and s.id <> m.id
        order by m.n
      loop
        exit when made = 3;
        select coalesce((select skill from public.skills where user_id = pair.mentor_id and type = 'can_teach' order by id limit 1), field_a)
          into topic;
        started := now() - make_interval(days => 14 + (abs(hashtext(pair.mentor_id::text || pair.mentee_id::text)) % 110));
        begin
          insert into public.sessions (mentor_id, mentee_id, title, status, topics, created_at, accepted_at,
            scheduled_at, occurred_at, mentee_completed_at, mentor_completed_at, last_activity_at)
          values (pair.mentor_id, pair.mentee_id, '[Demo] ' || topic, 'completed', jsonb_build_array(topic), started,
            started + interval '1 day', started + interval '5 days', started + interval '5 days',
            started + interval '5 days', started + interval '5 days', started + interval '5 days');
          made := made + 1;
          added := added + 1;
        exception when others then
          raise notice 'Skipped one pairing in % and %: %', field_a, field_b, sqlerrm;
        end;
      end loop;
    end loop;
  end loop;
  raise notice 'Added % demo meetings across % fields of study.', added, array_length(fields, 1);
end $$;
