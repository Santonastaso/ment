import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const owner = '10000000-0000-0000-0000-000000000001';
const applicant = '10000000-0000-0000-0000-000000000002';
const outsider = '10000000-0000-0000-0000-000000000003';
const organization = '20000000-0000-0000-0000-000000000001';

test('pilot feedback migrations: group lifecycle, tenant boundaries, capacity and relevance', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const as = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  try {
    await db.exec(`
      create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    await db.exec(await migration('0001_init.sql'));
    await db.exec(`
      create table organizations(id uuid primary key, name text, type text default 'intra');
      alter table profiles add column organization_id uuid references organizations(id),
        add column admin_scope text default 'none', add column program text default '',
        add column cohort_year integer, add column role text default 'student',
        add column working_language text default 'en', add column mentorship_paused boolean default false,
        add column mentorship_unavailable_until date, add column weekly_meeting_limit int default 5,
        add column monthly_meeting_limit int default 10;
      alter table sessions add column accepted_at timestamptz, add column request_expires_at timestamptz;
      create table mentorship_unavailable_periods(user_id uuid, start_date date, end_date date);
      create function public.is_active_user() returns boolean language sql stable as
        $$ select exists(select 1 from profiles where id = auth.uid() and deactivated_at is null) $$;
      create function public.redacted_name(text) returns text language sql as $$ select 'Network member'::text $$;
      create function public.directory_browse(integer, integer, text, text, integer, text, text, text)
        returns jsonb language sql as $$ select '{}'::jsonb $$;
      insert into organizations(id, name) values('${organization}', 'Pilot'),
        ('20000000-0000-0000-0000-000000000002', 'Other organization');
      insert into auth.users values('${owner}'), ('${applicant}'), ('${outsider}');
      insert into profiles(id, name, organization_id, onboarding_complete) values
        ('${owner}', 'Zoe Finance', '${organization}', true),
        ('${applicant}', 'Alice Applicant', '${organization}', true),
        ('${outsider}', 'Other Organization', '20000000-0000-0000-0000-000000000002', true);
    `);
    const groups = await migration('20260905162215_0028_school_kpis_groups_reminders.sql');
    await db.exec(groups.split('create table if not exists public.notification_outbox')[0]);
    const core = await migration('20260917120000_0038_production_core.sql');
    await db.exec(core.slice(core.indexOf('create or replace function public.is_active_connection'), core.indexOf('create or replace function public.expire_pending_requests')));
    for (const name of ['20261001100000_0056_discovery_availability.sql', '20261001101000_0057_group_join_requests.sql', '20261001102000_0058_directory_relevance.sql']) await db.exec(await migration(name));

    await as(owner);
    const { value: created } = await one("select create_group('Finance group', 'Learn finance') value");
    await as(applicant);
    await db.query('select request_group_join($1, $2)', [created.id, 'I want to learn financial modelling']);
    assert.equal((await one('select count(*)::int value from group_members where user_id = $1', [applicant])).value, 0);
    assert.equal((await one('select my_groups() value')).value[0].join_status, 'pending');
    await assert.rejects(db.query('select request_group_join($1, $2)', [created.id, 'Duplicate']), /request_pending/);
    await assert.rejects(db.query('select review_group_join($1, $2, true)', [created.id, applicant]), /not_allowed/);
    await as(outsider);
    await assert.rejects(db.query('select request_group_join($1, $2)', [created.id, 'Cross tenant']), /not_allowed/);
    assert.deepEqual((await one('select pending_group_requests($1) value', [created.id])).value, []);
    await as(owner);
    assert.equal((await one('select pending_group_requests($1) value', [created.id])).value.length, 1);
    await db.query('select review_group_join($1, $2, true)', [created.id, applicant]);
    assert.equal((await one('select count(*)::int value from group_members where user_id = $1', [applicant])).value, 1);
    await as(applicant);
    await db.query('select leave_group($1)', [created.id]);
    await db.query('select request_group_join($1, $2)', [created.id, 'Another request']);
    await db.exec("update group_join_requests set expires_at = now() - interval '1 second'");
    assert.equal((await one('select my_groups() value')).value[0].join_status, 'expired');
    await as(owner);
    await assert.rejects(db.query('select review_group_join($1, $2, true)', [created.id, applicant]), /request_expired/);
    await as(applicant);
    await db.query('select request_group_join($1, $2)', [created.id, 'Fresh request']);
    await db.query('select withdraw_group_join($1)', [created.id]);
    assert.equal((await one('select my_groups() value')).value[0].join_status, 'withdrawn');
    assert.equal((await one("select has_function_privilege('authenticated', 'available_discovery_profiles(uuid,uuid[])', 'EXECUTE') value")).value, false);
    assert.equal((await one("select has_function_privilege('anon', 'request_group_join(bigint,text)', 'EXECUTE') value")).value, false);

    await db.exec(`update profiles set department = 'Finance', job_title = 'Financial analyst' where id = '${owner}';
      insert into skills(user_id, skill, type) values ('${owner}', 'Financial modelling', 'can_teach'),
        ('${applicant}', 'Financial modelling', 'wants_to_learn');`);
    assert.equal((await one('select directory_browse() value')).value.people[0].id, owner);
    assert.equal((await one("select directory_browse(p_query => 'financial modelling') value")).value.total, 1);
    assert.equal((await one('select directory_browse() value')).value.total, 1);
    await db.exec(`insert into sessions(mentor_id, mentee_id, title, status, accepted_at)
      select '${owner}', '${applicant}', 'Capacity test', 'scheduled', now() from generate_series(1,5)`);
    assert.equal((await one('select is_currently_available_mentor($1) value', [owner])).value, false);
    assert.equal((await one('select directory_browse() value')).value.total, 0);
    assert.deepEqual((await one('select available_discovery_profiles($1, $2::uuid[]) value', [organization, [owner, outsider]])).value, []);
    await as(owner);
    assert.equal((await one('select my_meeting_capacity() value')).value.weekly_booked, 5);
    await db.exec("update sessions set status = 'cancelled'");
    await db.query('insert into mentorship_unavailable_periods values ($1, current_date, current_date)', [owner]);
    assert.equal((await one('select my_meeting_capacity() value')).value.available, false);
    await db.exec('delete from mentorship_unavailable_periods');
    await db.query('update profiles set mentorship_paused = true where id = $1', [owner]);
    assert.equal((await one('select my_meeting_capacity() value')).value.available, false);
    await db.query('update profiles set mentorship_paused = false, deactivated_at = now() where id = $1', [owner]);
    await assert.rejects(db.query('select my_meeting_capacity()'), /not_allowed/);

    await db.query('update profiles set deactivated_at = null where id = $1', [owner]);
    await db.exec(`
      alter table organizations add column incoming_request_limit int default 5,
        add column pending_request_limit int default 3, add column request_cooldown_days int default 7;
      alter table sessions add column idempotency_key uuid, add column follow_up_intent text default 'one_off',
        add column occurred_at timestamptz, add column outbound_message text, add column last_activity_at timestamptz;
      create unique index sessions_request_key on sessions(mentee_id, idempotency_key) where idempotency_key is not null;
      create function session_payload(s sessions, caller uuid) returns jsonb language sql as $$ select to_jsonb(s) $$;
    `);
    const hardened = await migration('20260905162248_0029_security_hardening.sql');
    await db.exec(hardened.slice(hardened.indexOf('create function public.request_session('), hardened.indexOf('drop function if exists public.accept_session')));
    const conversations = await migration('20260909110000_0037_conversations_and_capacity.sql');
    await db.exec(conversations.slice(conversations.indexOf('create table if not exists public.session_messages'), conversations.indexOf('alter table public.session_messages enable row level security')));
    await db.exec(conversations.slice(conversations.indexOf('create or replace function public.my_session_relationships'), conversations.indexOf('create or replace function public.my_session_messages')));
    await db.exec(conversations.slice(conversations.indexOf('create or replace function public.pm_set_outbound_message'), conversations.indexOf('create or replace function public.accept_session')));
    await db.exec(await migration('20261001103000_0059_atomic_conversation_request.sql'));
    await db.exec(await migration('20261001104000_0060_request_expiry_guard.sql'));
    await db.exec(await migration('20261004100000_0066_request_retry_integrity.sql'));
    await db.exec('create trigger pm_session_guard before insert or update on sessions for each row execute function pm_session_guard()');
    await db.exec(`delete from group_members where group_id = ${created.id} and user_id = '${owner}';
      insert into group_join_requests(group_id, user_id, reason) values (${created.id}, '${owner}', 'Self request');`);
    await db.exec(await migration('20261005102000_0073_group_owner_and_request_restart.sql'));
    await as(owner);
    assert.equal((await one('select count(*)::int value from group_members where group_id = $1 and user_id = $2', [created.id, owner])).value, 1);
    assert.equal((await one('select status from group_join_requests where group_id = $1 and user_id = $2', [created.id, owner])).status, 'withdrawn');
    await assert.rejects(db.query('select leave_group($1)', [created.id]), /group_owner_cannot_leave/);
    await assert.rejects(db.query('select request_group_join($1, $2)', [created.id, 'Again']), /group_owner_cannot_join/);
    await assert.rejects(db.query('select review_group_join($1, $2, true)', [created.id, owner]), /cannot_review_self/);
    await db.query("update profiles set role = 'alumnus' where id = $1", [owner]);
    await as(applicant);
    const key = '40000000-0000-0000-0000-000000000001';
    const request = () => db.query(`select request_conversation($1, 'Finance help', 'Please help',
      p_pre_session_question => $2, p_idempotency_key => $3) value`, [owner, 'A'.repeat(1000), key]);
    const sent = (await request()).rows[0].value;
    assert.equal((await one('select pre_session_question from sessions where id = $1', [sent.id])).pre_session_question.length, 1000);
    assert.equal((await request()).rows[0].value.id, sent.id);
    assert.equal((await one('select count(*)::int value from session_messages where session_id = $1', [sent.id])).value, 1);
    await assert.rejects(db.query(`select request_conversation($1, 'Finance help', 'Changed text',
      p_pre_session_question => $2, p_idempotency_key => $3)`, [owner, 'A'.repeat(1000), key]), /idempotency_conflict/);
    assert.equal((await one('select outbound_message from sessions where id = $1', [sent.id])).outbound_message, 'Please help');
    assert.equal((await one('select body from session_messages where session_id = $1', [sent.id])).body, 'Please help');
    await assert.rejects(db.query(`select request_conversation($1, 'Again', 'Please help',
      p_pre_session_question => 'Finance help', p_idempotency_key => gen_random_uuid())`, [owner]), /active_session_exists/);
    await db.query("update sessions set status = 'cancelled' where id = $1", [sent.id]);
    assert.deepEqual((await one('select my_session_relationships() value')).value, []);
    const restarted = (await db.query(`select request_conversation($1, 'Fresh request', 'New message',
      p_pre_session_question => 'Finance help', p_idempotency_key => gen_random_uuid()) value`, [owner])).rows[0].value;
    assert.notEqual(restarted.id, sent.id);
    assert.equal((await one('select my_session_relationships() value')).value[0].session_id, restarted.id);
    assert.equal((await one('select count(*)::int value from session_messages where session_id = $1', [sent.id])).value, 1);
    await db.query("update sessions set created_at = now() - interval '8 days', request_expires_at = now() - interval '1 second' where id = $1", [restarted.id]);
    // Deliberately fail message storage to verify the real request RPC rolls back too.
    await db.exec("alter table session_messages add constraint simulated_failure check (body <> 'Simulate failure')");
    const before = (await one('select count(*)::int value from sessions')).value;
    await assert.rejects(db.query(`select request_conversation($1, 'Another request', 'Simulate failure',
      p_pre_session_question => 'Finance help', p_idempotency_key => gen_random_uuid())`, [owner]), /simulated_failure/);
    assert.equal((await one('select count(*)::int value from sessions')).value, before);
    await db.query(`select request_conversation($1, 'New after expiry', 'Please help again',
      p_pre_session_question => 'Finance help', p_idempotency_key => gen_random_uuid())`, [owner]);

    await db.exec('create function mark_matches_stale(uuid) returns void language sql as $$ select $$');
    const onboarding = await migration('0025_debounced_matching.sql');
    await db.exec(onboarding.slice(onboarding.indexOf('create or replace function public.save_onboarding('), onboarding.indexOf('-- 5) apply_reflection')));
    await db.query(`select save_onboarding(p_name => 'Alice Student', p_department => 'Finance',
      p_seniority => null, p_job_title => '', p_bio => 'Student', p_shadow_role_response => null,
      p_tenure_years => 0, p_location => 'Paris', p_career => $1, p_can_teach => '[]',
      p_wants_to_learn => '["Financial modelling"]', p_program => 'Masters & MSc',
      p_cohort_year => 2026, p_persona => 'student')`, [JSON.stringify([{ role_title: 'Intern', department: 'Finance', company: 'Pilot', description: 'Built a financial model' }])]);
    const saved = await one('select name, program, cohort_year, onboarding_complete from profiles where id = $1', [applicant]);
    assert.deepEqual(saved, { name: 'Alice Student', program: 'Masters & MSc', cohort_year: 2026, onboarding_complete: true });
    assert.equal((await one('select description from career_history where user_id = $1', [applicant])).description, 'Built a financial model');

    await db.exec('alter table profiles add column linkedin_headline text');
    await db.exec(await migration('20261001120000_0061_discovery_candidate_retrieval.sql'));
    await db.exec(`
      insert into auth.users select md5('candidate-' || n)::uuid from generate_series(1, 620) n;
      insert into profiles(id, name, organization_id, onboarding_complete, job_title)
        select md5('candidate-' || n)::uuid, 'Candidate ' || lpad(n::text, 4, '0'), '${organization}', true, 'General member'
        from generate_series(1, 620) n;
      insert into skills(user_id, skill, type) values(md5('candidate-620')::uuid, 'Accounting', 'can_teach');
    `);
    const pool = async (query = 'Accounting', selected = null) => (await one(
      'select discovery_candidates($1, $2, $3, $4) value', [organization, applicant, query, selected])).value;
    const target = (await one("select md5('candidate-620')::uuid id")).id;
    assert.equal((await pool())[0].id, target, 'relevant member beyond the first 100 is ranked first');
    assert.equal((await pool()).length, 100, 'only the ranked model payload is bounded');
    assert.deepEqual((await pool('General member', target)).map(p => p.id), [target], 'draft selection bypasses ranking cutoff');
    assert.deepEqual(await pool('Accounting', outsider), [], 'tenant boundary remains enforced');
    const coverage = (await one('select discovery_network_coverage($1, $2) value', [organization, applicant])).value;
    assert.equal(coverage.member_count, 621, 'coverage counts all members, not the first 500');
    assert.ok(coverage.skills.includes('Accounting'), 'coverage includes skills beyond the first 500');
    await db.query('update profiles set mentorship_paused = true where id = $1', [target]);
    assert.equal((await pool()).some(p => p.id === target), false, 'availability is applied before limiting');
    await db.query('update profiles set mentorship_paused = false where id = $1', [target]);
    await db.query("insert into sessions(mentor_id, mentee_id, title, status, request_expires_at) values ($1, $2, 'Pending', 'pending', now() + interval '1 day')", [target, applicant]);
    assert.equal((await pool()).some(p => p.id === target), false, 'active conversations are excluded');
    await db.query("update sessions set request_expires_at = now() - interval '1 day' where mentor_id = $1", [target]);
    assert.equal((await pool())[0].id, target, 'expired requests do not hide members');
    for (const fn of ['discovery_candidates(uuid,uuid,text,uuid)', 'discovery_network_coverage(uuid,uuid)']) {
      assert.equal((await one("select has_function_privilege('authenticated', $1, 'EXECUTE') value", [fn])).value, false);
      assert.equal((await one("select has_function_privilege('service_role', $1, 'EXECUTE') value", [fn])).value, true);
    }
  } finally { await db.close(); }
});
