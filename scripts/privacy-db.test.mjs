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
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, name text);
      insert into profiles values ('${me}', 'Me'), ('${peer}', 'Peer');
      create table skills(id bigserial primary key, user_id uuid, skill text);
      create table career_history(id bigserial primary key, user_id uuid, company text);
      create table profile_drafts(id bigserial primary key, user_id uuid, raw_text text);
      create table reflection_logs(id bigserial primary key, user_id uuid, body text);
      create table mentorship_unavailable_periods(id bigserial primary key, user_id uuid);
      create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid);
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, title text,
        reflection text, mentor_reflection text, mentee_rating int, mentor_rating int, route_token text);
      create table session_messages(id bigserial primary key, session_id bigint, sender_id uuid, body text);
      create table groups(id bigserial primary key, created_by uuid, route_token text);
      create table group_members(group_id bigint, user_id uuid);
      create table group_join_requests(group_id bigint, user_id uuid);
      create table group_messages(id bigserial primary key, sender_id uuid, body text);
      create table discovery_threads(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now());
      create table discovery_feedback(id bigserial primary key, user_id uuid);
      create table feedback_messages(id bigserial primary key, user_id uuid, reviewed_by uuid);
      create table continuation_intents(id bigserial primary key, user_id uuid);
      create table outcome_events(id bigserial primary key, actor_id uuid);
      create table calendar_connections(user_id uuid, provider text, token_ciphertext text, refresh_ciphertext text, provider_email text);
      create table calendar_events(id bigserial primary key, owner_id uuid);
      create table notification_outbox(id bigserial primary key, user_id uuid);
      insert into skills(user_id, skill) values ('${me}', 'Valuation'), ('${peer}', 'Not mine');
      insert into reflection_logs(user_id, body) values ('${me}', 'my note'), ('${peer}', 'their note');
      insert into sessions(mentor_id, mentee_id, title, reflection, mentor_reflection, mentee_rating, mentor_rating, route_token)
        values ('${peer}', '${me}', 'Valuation chat', 'mine', 'theirs', 5, 3, 'secret-link');
      insert into session_messages(session_id, sender_id, body) values (1, '${me}', 'hello'), (1, '${peer}', 'their message');
      insert into calendar_connections values ('${me}', 'google', 'cipher', 'cipher2', 'me@example.com');
    `);
    await db.exec(await migration('20261019100000_0086_consent_records_and_data_export.sql'));

    assert.equal((await one("select has_function_privilege('anon', 'public.export_my_data()', 'execute') value")).value, false);
    assert.equal((await one("select has_function_privilege('anon', 'public.record_consent(text, text, text)', 'execute') value")).value, false);

    await as(me);
    await db.exec('set role authenticated');

    // Consent goes through the function only, which sets who and when.
    const recorded = (await one("select record_consent('ai_profile_import', '2026-10-19', 'it') value")).value;
    assert.equal(recorded.text_version, '2026-10-19');
    await assert.rejects(db.query("select record_consent('marketing', 'v1')"), /check/);
    await assert.rejects(db.query(`insert into consent_records(user_id, purpose, text_version) values ('${peer}', 'ai_profile_import', 'v1')`), /permission denied/);
    assert.equal((await one('select count(*)::int value from consent_records')).value, 1);

    const data = (await one('select export_my_data() value')).value;
    assert.equal(data.profile.name, 'Me');
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

    // The other member gets their own export, not mine.
    await as(peer);
    const theirs = (await one('select export_my_data() value')).value;
    assert.equal(theirs.sessions[0].mentor_reflection, 'theirs');
    assert.ok(!('reflection' in theirs.sessions[0]));
    assert.deepEqual(theirs.consents, []);
    assert.equal((await one('select count(*)::int value from consent_records')).value, 0, 'consent rows are private');

    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(db.query('select export_my_data()'), /auth_required/);
  } finally {
    await db.close();
  }
});
