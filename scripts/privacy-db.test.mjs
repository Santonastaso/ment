import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const me = '10000000-0000-0000-0000-000000000001';
const peer = '10000000-0000-0000-0000-000000000002';

test('consent is recorded by the server, and an export holds only the caller\'s own data', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const as = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  try {
    // Only the columns the export touches, with the names production uses.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; grant usage on schema auth to authenticated;
      create table auth.users(id uuid primary key, email text, encrypted_password text);
      insert into auth.users values
        ('${me}', 'me@example.test', 'private-password-hash'),
        ('${peer}', 'peer@example.test', 'other-password-hash');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, name text, deactivated_at timestamptz, erased_at timestamptz);
      insert into profiles(id, name) values ('${me}', 'Me'), ('${peer}', 'Peer');
      create table skills(id bigserial primary key, user_id uuid, skill text);
      create table career_history(id bigserial primary key, user_id uuid, company text);
      create table profile_drafts(id bigserial primary key, user_id uuid, raw_text text);
      create table reflection_logs(id bigserial primary key, user_id uuid, body text);
      create table mentorship_unavailable_periods(id bigserial primary key, user_id uuid);
      create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid);
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, title text,
        reflection text, mentor_reflection text, mentee_rating int, mentor_rating int, route_token text,
        outbound_message text default 'request by sender', pre_session_question text default 'sender question',
        topics jsonb default '["generated topic"]', meeting_url text default 'secret-meeting-link');
      create table session_messages(id bigserial primary key, session_id bigint, sender_id uuid, body text);
      create table groups(id bigserial primary key, created_by uuid, route_token text);
      create table group_members(group_id bigint, user_id uuid);
      create table group_join_requests(group_id bigint, user_id uuid);
      create table group_messages(id bigserial primary key, sender_id uuid, body text);
      create table discovery_threads(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), turns jsonb default '[]');
      create table discovery_feedback(id bigserial primary key, user_id uuid);
      create table feedback_messages(id bigserial primary key, user_id uuid, reviewed_by uuid);
      create table continuation_intents(id bigserial primary key, user_id uuid);
      create table outcome_events(id bigserial primary key, actor_id uuid);
      create table calendar_connections(user_id uuid, provider text, token_ciphertext text, refresh_ciphertext text, provider_email text);
      create table calendar_events(id bigserial primary key, owner_id uuid, join_url text, html_url text);
      create table notification_outbox(id bigserial primary key, user_id uuid);
      create table meeting_benefits(session_id bigint, user_id uuid, answer text, created_at timestamptz default now());
      create table ai_runs(id bigserial primary key, user_id uuid, organization_id uuid, feature text,
        prompt_version text, model text, status text, latency_ms int, error_code text,
        created_at timestamptz default now(), secret_payload text);
      create table audit_logs(id bigserial primary key, actor_id uuid, action text, target_type text,
        target_id text, metadata jsonb, ip text, created_at timestamptz default now());
      create table invitations(id bigserial primary key, organization_id uuid, email text, token_hash text,
        profile_data jsonb, status text, invited_by uuid, expires_at timestamptz,
        accepted_at timestamptz, accepted_user_id uuid, created_at timestamptz default now());
      create table outreach_targets(id bigserial primary key, organization_id uuid, profile_id uuid,
        email text, persona text, cohort_term text, invited_at timestamptz,
        is_demo boolean, created_at timestamptz default now());
      insert into skills(user_id, skill) values ('${me}', 'Valuation'), ('${peer}', 'Not mine');
      insert into reflection_logs(user_id, body) values ('${me}', 'my note'), ('${peer}', 'their note');
      insert into sessions(mentor_id, mentee_id, title, reflection, mentor_reflection, mentee_rating, mentor_rating, route_token)
        values ('${peer}', '${me}', 'Valuation chat', 'mine', 'theirs', 5, 3, 'secret-link');
      insert into session_messages(session_id, sender_id, body) values (1, '${me}', 'hello'), (1, '${peer}', 'their message');
      insert into discovery_threads(user_id, turns) values ('${me}', '[{"role":"user","content":"my search","matches":[{"name":"hidden snapshot"}]},{"role":"assistant","content":"suggested person","matches":[{"name":"hidden snapshot","location":"hidden city"}]}]');
      insert into calendar_connections values ('${me}', 'google', 'cipher', 'cipher2', 'me@example.com');
      insert into calendar_events(owner_id, join_url, html_url) values ('${me}', 'secret-join-url', 'secret-event-url');
      insert into ai_runs(user_id, feature, prompt_version, model, status, latency_ms, secret_payload)
        values ('${me}', 'reflection', 'v1', 'test-model', 'succeeded', 12, 'hidden prompt'),
               ('${peer}', 'profile_ingest', 'v2', 'test-model', 'failed', 5, 'peer document');
      insert into audit_logs(actor_id, action, target_type, target_id, metadata, ip)
        values ('${me}', 'profile.updated', 'profiles', '${peer}', '{"private":"other member"}', '192.0.2.1'),
               ('${peer}', 'peer.action', 'profiles', '${me}', '{"private":"peer metadata"}', '192.0.2.2');
      insert into invitations(email, token_hash, profile_data, status, invited_by, expires_at, accepted_at, accepted_user_id)
        values ('me@example.test', 'secret-hash', '{"name":"Me"}', 'accepted', '${peer}', now(), now(), '${me}'),
               ('peer@example.test', 'peer-secret', '{"name":"Peer"}', 'accepted', '${me}', now(), now(), '${peer}'),
               ('me@example.test', 'pending-secret', '{}', 'pending', '${peer}', now(), null, '${me}');
      insert into outreach_targets(profile_id, email, persona, cohort_term, invited_at, is_demo)
        values ('${me}', 'me@example.test', 'student', 'Autumn', now(), false),
               ('${peer}', 'peer@example.test', 'alumnus', 'Spring', now(), false);
    `);
    await db.exec(await migration('20261019100000_0086_consent_records_and_data_export.sql'));
    await db.exec(await migration('20261105100000_0099_complete_member_export.sql'));
    await db.exec(await migration('20261106100000_0104_idempotent_terms_review.sql'));
    await db.exec(await migration('20261106120000_0106_lean_member_export.sql'));

    assert.equal((await one("select has_function_privilege('anon', 'public.export_my_data()', 'execute') value")).value, false);
    assert.equal((await one("select has_function_privilege('authenticated', 'public.export_my_data()', 'execute') value")).value, true);
    assert.equal((await one("select has_function_privilege('anon', 'public.record_consent(text, text, text)', 'execute') value")).value, false);

    await as(me);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select email from auth.users'), /permission denied/);
    await assert.rejects(db.query('select * from audit_logs'), /permission denied/);

    // Consent goes through the function only, which sets who and when.
    const recorded = (await one("select record_consent('ai_profile_import', '2026-10-19', 'it') value")).value;
    assert.equal(recorded.text_version, '2026-10-19');
    await assert.rejects(db.query("select record_consent('marketing', 'v1')"), /check/);
    await assert.rejects(db.query(`insert into consent_records(user_id, purpose, text_version) values ('${peer}', 'ai_profile_import', 'v1')`), /permission denied/);
    assert.equal((await one('select count(*)::int value from consent_records')).value, 1);
    const terms = (await one("select record_consent('terms_privacy', '2026-09-08', 'en') value")).value;
    const replayed = (await one("select record_consent('terms_privacy', '2026-09-08', 'fr') value")).value;
    assert.deepEqual(replayed, terms);
    assert.equal((await one("select count(*)::int value from consent_records where purpose = 'terms_privacy'")).value, 1);

    const data = (await one('select export_my_data() value')).value;
    assert.equal(data.profile.name, 'Me');
    assert.equal(data.format, 'ment-export-2');
    assert.equal(data.sessions[0].title, 'Valuation chat');
    assert.equal(data.sessions[0].outbound_message, 'request by sender');
    assert.deepEqual(data.discovery_threads[0].messages_sent, [{ role: 'user', content: 'my search' }]);
    assert.ok(!JSON.stringify(data).includes('hidden snapshot'));
    assert.ok(!JSON.stringify(data).includes('hidden city'));
    assert.ok(!JSON.stringify(data).includes('secret-meeting-link'));
    assert.ok(!JSON.stringify(data).includes('secret-join-url'));
    assert.ok(!JSON.stringify(data).includes('secret-event-url'));
    assert.deepEqual(data.skills.map(s => s.skill), ['Valuation']);
    assert.deepEqual(data.reflections.map(r => r.body), ['my note']);
    // A shared session keeps my side only, and no link that would open it.
    assert.equal(data.sessions[0].reflection, 'mine');
    assert.equal(data.sessions[0].mentee_rating, 5);
    for (const hidden of ['mentor_reflection', 'mentor_rating', 'route_token']) assert.ok(!(hidden in data.sessions[0]), hidden);
    assert.deepEqual(data.session_messages_sent.map(m => m.body), ['hello']);
    assert.ok(!('token_ciphertext' in data.calendar_connections[0]));
    assert.ok(!('refresh_ciphertext' in data.calendar_connections[0]));
    assert.equal(data.consents[0].locale, 'it');
    assert.deepEqual(data.auth_account, { email: 'me@example.test' });
    assert.deepEqual(data.ai_runs.map(x => x.feature), ['reflection']);
    assert.ok(!('secret_payload' in data.ai_runs[0]));
    assert.deepEqual(data.audit_actions.map(x => x.action), ['profile.updated']);
    assert.deepEqual(Object.keys(data.audit_actions[0]).sort(), ['action', 'created_at', 'id']);
    assert.deepEqual(data.accepted_invitations.map(x => x.email), ['me@example.test']);
    assert.equal(data.accepted_invitations[0].profile_data.name, 'Me');
    assert.ok(!('token_hash' in data.accepted_invitations[0]));
    assert.ok(!('invited_by' in data.accepted_invitations[0]));
    assert.ok(!JSON.stringify(data).includes('pending-secret'));
    assert.deepEqual(data.outreach_targets.map(x => x.email), ['me@example.test']);
    assert.ok(!JSON.stringify(data).includes('private-password-hash'));
    assert.ok(!JSON.stringify(data).includes('other member'));
    assert.ok(!JSON.stringify(data).includes('peer document'));

    // The other member gets their own export, not mine.
    await as(peer);
    const theirs = (await one('select export_my_data() value')).value;
    assert.equal(theirs.sessions[0].mentor_reflection, 'theirs');
    assert.ok(!('reflection' in theirs.sessions[0]));
    for (const field of ['title', 'outbound_message', 'pre_session_question', 'topics', 'meeting_url']) assert.ok(!(field in theirs.sessions[0]), field);
    assert.deepEqual(theirs.consents, []);
    assert.deepEqual(theirs.auth_account, { email: 'peer@example.test' });
    assert.deepEqual(theirs.ai_runs.map(x => x.feature), ['profile_ingest']);
    assert.deepEqual(theirs.audit_actions.map(x => x.action), ['peer.action']);
    assert.deepEqual(theirs.accepted_invitations.map(x => x.email), ['peer@example.test']);
    assert.deepEqual(theirs.outreach_targets.map(x => x.email), ['peer@example.test']);
    assert.ok(!JSON.stringify(theirs).includes('secret-hash'));
    assert.equal((await one('select count(*)::int value from consent_records')).value, 0, 'consent rows are private');

    await db.exec('reset role');
    await db.query('update profiles set deactivated_at = now() where id = $1', [me]);
    await as(me);
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select record_consent('terms_privacy', 'future-version')"), /account_deactivated/);
    await assert.rejects(db.query("select record_consent('ai_profile_import', 'future-version')"), /account_deactivated/);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(db.query('select export_my_data()'), /auth_required/);
  } finally {
    await db.close();
  }
});
