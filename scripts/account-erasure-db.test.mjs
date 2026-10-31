import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const leaver = '10000000-0000-0000-0000-000000000001';
const mentor = '10000000-0000-0000-0000-000000000002';
const friend = '10000000-0000-0000-0000-000000000003';
const admin = '10000000-0000-0000-0000-000000000004';

// Only the columns the two migrations touch, with production's names.
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table organizations(id uuid primary key);
  insert into organizations values ('${org}');
  create table profiles(id uuid primary key, organization_id uuid, name text not null default '', department text not null default '',
    job_title text not null default '', bio text not null default '', location text not null default '', seniority text default 'junior',
    tenure_years int not null default 0, shadow_role_response text not null default '', program text not null default '', cohort_year int,
    linkedin_url text, linkedin_headline text, notification_email text, external_source text, external_id text, source_synced_at timestamptz,
    manager_id uuid, mentorship_note text, mentorship_paused boolean not null default false, reflection_email_reminders boolean not null default true,
    onboarding_complete boolean not null default true, deactivated_at timestamptz, is_admin boolean not null default false,
    admin_scope text not null default 'none');
  create function is_currently_available_mentor(uuid) returns boolean language sql stable as $$ select true $$;
  create table skills(id bigserial primary key, user_id uuid, skill text, type text default 'can_teach');
  create table career_history(id bigserial primary key, user_id uuid, role_title text, company text, description text, start_year int, end_year int);
  create table profile_drafts(id bigserial primary key, user_id uuid);
  create table reflection_logs(id bigserial primary key, user_id uuid, created_at timestamptz default now());
  create table mentorship_unavailable_periods(id bigserial primary key, user_id uuid);
  create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid);
  create table match_scores(id bigserial primary key, user_a_id uuid, user_b_id uuid);
  create table sessions(id bigserial primary key, mentor_id uuid not null, mentee_id uuid not null, title text, status text,
    outbound_message text, pre_session_question text not null default '', reflection text not null default '', mentor_reflection text not null default '',
    mentee_rating int, mentor_rating int, request_expires_at timestamptz, last_activity_at timestamptz default now());
  create table session_messages(id bigserial primary key, session_id bigint, sender_id uuid, body text, created_at timestamptz default now());
  create table session_reads(session_id bigint, user_id uuid);
  create table groups(id bigserial primary key, created_by uuid not null, organization_id uuid default '${org}');
  create table group_members(group_id bigint references groups(id) on delete cascade, user_id uuid, role text default 'member', created_at timestamptz default now());
  create table group_join_requests(group_id bigint, user_id uuid);
  create table group_reads(group_id bigint, user_id uuid);
  create table group_messages(id bigserial primary key, group_id bigint, sender_id uuid, body text, created_at timestamptz default now());
  create table discovery_threads(id bigserial primary key, user_id uuid, selected_person_id uuid, updated_at timestamptz default now());
  create table discovery_feedback(id bigserial primary key, user_id uuid, profile_id uuid);
  create table feedback_messages(id bigserial primary key, user_id uuid);
  create table continuation_intents(id bigserial primary key, user_id uuid);
  create table outcome_events(id bigserial primary key, actor_id uuid, recipient_id uuid);
  create table calendar_connections(user_id uuid);
  create table calendar_events(id bigserial primary key, owner_id uuid);
  create table calendar_event_claims(id bigserial primary key, owner_id uuid);
  create table notification_outbox(id bigserial primary key, user_id uuid);
  create table consent_records(id bigserial primary key, user_id uuid);
  create table ai_runs(id bigserial primary key, user_id uuid);
  create table audit_logs(id bigserial primary key, actor_id uuid, action text, created_at timestamptz default now());
  create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
  create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
  create table outreach_targets(id bigserial primary key, profile_id uuid, email text);
  create table invitations(id bigserial primary key, email text not null, profile_data jsonb, accepted_user_id uuid);
`;

test('an erased account leaves nothing personal, and the other side keeps the conversation', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const count = async (sql) => (await one(`select count(*)::int n from ${sql}`)).n;
  try {
    await db.exec(SCHEMA);
    await db.exec(`
      insert into profiles(id, organization_id, name, job_title, bio, linkedin_url, notification_email) values
        ('${leaver}', '${org}', 'Leaver Person', 'Analyst', 'About me', 'https://linkedin.example/leaver', 'me@example.test'),
        ('${mentor}', '${org}', 'Mentor Person', 'Partner', '', null, null),
        ('${friend}', '${org}', 'Friend Person', 'Designer', '', null, null);
      insert into profiles(id, organization_id, name, admin_scope) values ('${admin}', '${org}', 'Admin', 'org');
      update profiles set manager_id = '${leaver}' where id = '${friend}';
      insert into sessions(mentor_id, mentee_id, title, status, outbound_message, pre_session_question, reflection, mentor_reflection, mentee_rating, mentor_rating)
        values ('${mentor}', '${leaver}', 'Valuation', 'completed', 'Hi, could we talk?', 'My question', 'my notes', 'mentor notes', 5, 4),
               ('${mentor}', '${leaver}', 'Follow-up', 'scheduled', 'Again?', '', '', '', null, null);
      insert into session_messages(session_id, sender_id, body) values (1, '${leaver}', 'leaver words'), (1, '${mentor}', 'mentor words');
      insert into groups(created_by) values ('${leaver}'), ('${leaver}');
      insert into group_members(group_id, user_id, role, created_at) values
        (1, '${leaver}', 'owner', now() - interval '2 days'), (1, '${friend}', 'member', now() - interval '1 day'), (2, '${leaver}', 'owner', now());
      insert into group_messages(group_id, sender_id, body) values (1, '${leaver}', 'hello group'), (1, '${friend}', 'hi');
      insert into skills(user_id, skill) values ('${leaver}', 'Valuation'), ('${mentor}', 'Valuation');
      insert into career_history(user_id, role_title) values ('${leaver}', 'Analyst');
      insert into reflection_logs(user_id) values ('${leaver}');
      insert into discovery_threads(user_id, selected_person_id) values ('${leaver}', '${mentor}'), ('${friend}', '${leaver}');
      insert into calendar_connections values ('${leaver}');
      insert into consent_records(user_id) values ('${leaver}');
      insert into ai_runs(user_id) values ('${leaver}');
      insert into outreach_targets(profile_id, email) values ('${leaver}', 'me@example.test');
      insert into invitations(email, profile_data, accepted_user_id) values ('me@example.test', '{"name":"Leaver Person"}', '${leaver}');
    `);
    await db.exec(await migration('20261019110000_0087_ai_opt_out_and_account_erasure.sql'));
    await db.exec(await migration('20261019130000_0089_data_retention.sql'));
    await db.exec(await migration('20261020110000_0091_retention_storage_cleanup_order.sql'));
    // 0096 adds "did this meeting help" answers, which erasure must also remove.
    await db.exec(await migration('20261031100000_0096_admin_scorecard.sql'));
    await db.exec(`insert into meeting_benefits(session_id, user_id, answer) values (1, '${leaver}', 'yes')`);

    // Only the server may erase.
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(`select has_function_privilege('${role}', 'public.erase_account_data(uuid)', 'execute') value`)).value, false);
    }
    await assert.rejects(db.query('select erase_account_data($1)', [admin]), /admin_account/);

    const result = (await one('select erase_account_data($1) value', [leaver])).value;
    assert.deepEqual(result, { erased: true, cancelled_sessions: 1 });
    assert.deepEqual((await one('select retention_auth_cleanup_candidates() value')).value, [leaver]);

    const profile = await one('select * from profiles where id = $1', [leaver]);
    assert.equal(profile.name, 'Former member');
    for (const field of ['job_title', 'bio']) assert.equal(profile[field], '');
    for (const field of ['linkedin_url', 'notification_email']) assert.equal(profile[field], null);
    assert.ok(profile.deactivated_at && profile.erased_at && profile.ai_opt_out);
    assert.equal((await one('select manager_id from profiles where id = $1', [friend])).manager_id, null);

    // The mentor keeps the sessions and their own words; the leaver's words are gone.
    const sessions = (await db.query('select * from sessions order by id')).rows;
    assert.deepEqual(sessions.map(s => s.status), ['completed', 'cancelled']);
    assert.deepEqual([sessions[0].outbound_message, sessions[0].pre_session_question, sessions[0].reflection, sessions[0].mentee_rating], ['', '', '', null]);
    assert.deepEqual([sessions[0].mentor_reflection, sessions[0].mentor_rating], ['mentor notes', 4]);
    assert.deepEqual((await db.query('select body from session_messages')).rows.map(r => r.body), ['mentor words']);

    // The shared group passes to its other member; the empty one closes.
    assert.deepEqual((await db.query('select id, created_by from groups')).rows, [{ id: 1, created_by: friend }]);
    assert.deepEqual((await db.query('select user_id, role from group_members')).rows, [{ user_id: friend, role: 'owner' }]);
    assert.deepEqual((await db.query('select body from group_messages')).rows.map(r => r.body), ['hi']);

    for (const table of ['skills where user_id', 'career_history where user_id', 'reflection_logs where user_id',
      'discovery_threads where user_id', 'calendar_connections where user_id', 'consent_records where user_id', 'ai_runs where user_id']) {
      assert.equal(await count(`${table} = '${leaver}'`), 0, table);
    }
    assert.equal(await count(`skills where user_id = '${mentor}'`), 1, 'other people\'s data is untouched');
    assert.equal(await count('meeting_benefits'), 0, 'their answers about meetings are gone too');
    assert.equal(await count(`discovery_threads where selected_person_id = '${leaver}'`), 0);
    assert.equal((await one('select email from outreach_targets')).email, null);
    const invitation = await one('select email, profile_data from invitations');
    assert.match(invitation.email, /^erased-\d+@invalid$/);
    assert.deepEqual(invitation.profile_data, {});

    // Running it again is harmless, so a retry after a partial failure is safe.
    assert.equal((await one('select erase_account_data($1) value', [leaver])).value.erased, true);
    assert.equal((await one('select complete_account_auth_cleanup($1) value', [leaver])).value, true);
    assert.deepEqual((await one('select retention_auth_cleanup_candidates() value')).value, []);
  } finally {
    await db.close();
  }
});

test('a member who opts out of AI is never sent to the model as a candidate', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(SCHEMA);
    await db.exec(`
      insert into profiles(id, organization_id, name, job_title, department) values
        ('${leaver}', '${org}', 'Asker', 'Student', 'Finance'),
        ('${mentor}', '${org}', 'Valuation Expert', 'Partner', 'Finance'),
        ('${friend}', '${org}', 'Private Expert', 'Director', 'Strategy');
      insert into skills(user_id, skill) values ('${mentor}', 'Valuation'), ('${friend}', 'Valuation');
    `);
    await db.exec(await migration('20261019110000_0087_ai_opt_out_and_account_erasure.sql'));
    const names = async () => (await one('select discovery_candidates($1, $2, $3) value', [org, leaver, 'valuation'])).value.map(p => p.name).sort();
    const coverage = async () => (await one('select discovery_network_coverage($1, $2) value', [org, leaver])).value;
    assert.deepEqual(await names(), ['Private Expert', 'Valuation Expert']);
    assert.equal((await coverage()).member_count, 2);

    await db.query('update profiles set ai_opt_out = true where id = $1', [friend]);
    assert.deepEqual(await names(), ['Valuation Expert']);
    const after = await coverage();
    assert.equal(after.member_count, 1);
    assert.deepEqual(after.departments, ['Finance']);
    // The member can switch it themselves; nothing else on the row opened up.
    assert.equal((await one("select has_column_privilege('authenticated', 'public.profiles', 'ai_opt_out', 'update') value")).value, true);
    assert.equal((await one("select has_column_privilege('authenticated', 'public.profiles', 'erased_at', 'update') value")).value, false);
  } finally {
    await db.close();
  }
});

test('retention deletes nothing until periods are set, then only what is older than them', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const count = async (table) => (await one(`select count(*)::int n from ${table}`)).n;
  const old = "now() - interval '400 days'";
  try {
    await db.exec(SCHEMA);
    await db.exec(`
      insert into profiles(id, organization_id, name) values ('${leaver}', '${org}', 'Long Gone'), ('${mentor}', '${org}', 'Mentor'), ('${friend}', '${org}', 'Friend');
      insert into profiles(id, organization_id, name, admin_scope) values ('${admin}', '${org}', 'Admin', 'org');
      update profiles set deactivated_at = ${old} where id = '${leaver}';
      update profiles set deactivated_at = now() - interval '5 days' where id = '${friend}';
      insert into sessions(mentor_id, mentee_id, title, status, outbound_message, last_activity_at) values
        ('${mentor}', '${friend}', 'Old', 'completed', 'old words', ${old}), ('${mentor}', '${friend}', 'New', 'completed', 'new words', now());
      insert into session_messages(session_id, sender_id, body, created_at) values (1, '${mentor}', 'old', ${old}), (2, '${mentor}', 'new', now());
      insert into groups(created_by) values ('${mentor}');
      insert into group_messages(group_id, sender_id, body, created_at) values (1, '${mentor}', 'old', ${old}), (1, '${mentor}', 'new', now());
      insert into discovery_threads(user_id, updated_at) values ('${mentor}', ${old}), ('${mentor}', now());
      insert into reflection_logs(user_id, created_at) values ('${mentor}', ${old}), ('${mentor}', now());
      insert into audit_logs(actor_id, action, created_at) values ('${mentor}', 'x', ${old}), ('${mentor}', 'x', now()), (null, 'system', ${old});
    `);
    await db.exec(await migration('20261019110000_0087_ai_opt_out_and_account_erasure.sql'));
    await db.exec(await migration('20261019130000_0089_data_retention.sql'));
    await db.exec(await migration('20261020110000_0091_retention_storage_cleanup_order.sql'));
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(`select has_function_privilege('${role}', 'public.run_data_retention()', 'execute') value`)).value, false);
      assert.equal((await one(`select has_function_privilege('${role}', 'public.retention_account_candidates()', 'execute') value`)).value, false);
      assert.equal((await one(`select has_function_privilege('${role}', 'public.run_retention_account_erasure(uuid[])', 'execute') value`)).value, false);
      assert.equal((await one(`select has_function_privilege('${role}', 'public.retention_auth_cleanup_candidates()', 'execute') value`)).value, false);
      assert.equal((await one(`select has_function_privilege('${role}', 'public.complete_account_auth_cleanup(uuid)', 'execute') value`)).value, false);
    }

    // No periods: nothing goes.
    const idle = (await one('select run_data_retention() value')).value;
    assert.deepEqual(idle, { messages: 0, sessions_cleared: 0, searches: 0, reflections: 0, audit_logs: 0, erased_user_ids: [] });
    assert.equal(await count('session_messages'), 2);

    // An admin sets the periods for their own organisation; members cannot.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [mentor]);
    await assert.rejects(db.query(`select admin_set_retention_settings('{"conversation_days": 365}')`), /admin_only/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    await assert.rejects(db.query(`select admin_set_retention_settings('{"conversation_days": 7}')`), /check/);
    const saved = (await one(`select admin_set_retention_settings('{"conversation_days": 365, "search_days": "365", "reflection_days": 365, "audit_log_days": 365, "deactivated_account_days": 365}') value`)).value;
    assert.equal(saved.conversation_days, 365);

    const candidates = (await one('select retention_account_candidates() value')).value;
    assert.deepEqual(candidates, [leaver]);
    const swept = (await one('select run_data_retention() value')).value;
    assert.deepEqual(swept, { messages: 2, sessions_cleared: 1, searches: 1, reflections: 1, audit_logs: 1, erased_user_ids: [] });
    assert.deepEqual((await db.query('select body from session_messages')).rows.map(r => r.body), ['new']);
    assert.deepEqual((await db.query('select body from group_messages')).rows.map(r => r.body), ['new']);
    assert.deepEqual((await db.query('select outbound_message from sessions order by id')).rows.map(r => r.outbound_message), ['', 'new words']);
    assert.equal(await count('discovery_threads'), 1);
    assert.equal(await count('reflection_logs'), 1);
    assert.equal(await count('audit_logs'), 2, 'recent entries and system entries stay');
    // Account cleanup is finalized only after the Edge Function has removed
    // Storage objects for the returned candidates.
    assert.equal((await one('select name from profiles where id = $1', [leaver])).name, 'Long Gone');
    assert.deepEqual((await one('select run_retention_account_erasure($1) value', [candidates])).value, [leaver]);
    assert.deepEqual((await one('select retention_auth_cleanup_candidates() value')).value, [leaver]);
    assert.equal((await one('select complete_account_auth_cleanup($1) value', [leaver])).value, true);
    // Deactivated long ago: erased. Deactivated last week: kept.
    assert.equal((await one('select name from profiles where id = $1', [leaver])).name, 'Former member');
    assert.equal((await one('select name from profiles where id = $1', [friend])).name, 'Friend');
    // Running again finds nothing new.
    assert.deepEqual((await one('select retention_account_candidates() value')).value, []);
  } finally {
    await db.close();
  }
});
