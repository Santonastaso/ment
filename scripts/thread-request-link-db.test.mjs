import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const student = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const mentor = '10000000-0000-0000-0000-000000000003';
const NEW_SIGNATURE = 'public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text, uuid)';

test('a request and the link to its search are written together, by the server only', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const as = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  const key = n => `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const send = (title, idempotency, thread) => db.query(
    `select request_conversation($1, $2, 'Please help', p_pre_session_question => 'A question',
      p_idempotency_key => $3${thread ? ', p_thread_id => $4' : ''}) value`,
    thread ? [mentor, title, idempotency, thread] : [mentor, title, idempotency]).then(result => result.rows[0].value);
  const sessions = async () => (await one('select count(*)::int value from sessions')).value;
  try {
    // The parts of the schema the function touches, with the same grants and
    // row policy the real table has before this migration.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key);
      insert into profiles values ('${student}'), ('${other}'), ('${mentor}');
      create table sessions(id bigserial primary key, mentee_id uuid, mentor_id uuid, title text, outbound_message text,
        scheduled_at timestamptz, duration_minutes integer, pre_session_question text, topics jsonb,
        follow_up_intent text, idempotency_key uuid, status text default 'pending');
      grant select on sessions to authenticated; -- so the test can count requests as that user
      create function is_active_user() returns boolean language sql stable as $$ select auth.uid() is not null $$;
      create function session_payload(s sessions, caller uuid) returns jsonb language sql as $$ select to_jsonb(s) $$;
      create function pm_request_session(p_mentor_id uuid, p_title text, p_scheduled_at timestamptz, p_duration_minutes integer,
        p_pre_session_question text, p_topics jsonb, p_idempotency_key uuid, p_follow_up_intent text)
        returns jsonb language plpgsql security definer as $$
        declare created sessions; begin
          insert into sessions(mentee_id, mentor_id, title, scheduled_at, duration_minutes, pre_session_question, topics, follow_up_intent, idempotency_key)
            values (auth.uid(), p_mentor_id, trim(p_title), p_scheduled_at, least(greatest(coalesce(p_duration_minutes, 60), 15), 240),
              coalesce(p_pre_session_question, ''), p_topics, p_follow_up_intent, p_idempotency_key) returning * into created;
          return to_jsonb(created);
        end $$;
      create function pm_set_outbound_message(p_session_id bigint, p_message text) returns void language sql security definer as
        $$ update sessions set outbound_message = trim(p_message) where id = p_session_id $$;
      create table discovery_threads (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
        title text not null default 'New conversation', intent text not null default 'one_off',
        turns jsonb not null default '[]', selected_person_id uuid references profiles(id) on delete set null,
        archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      alter table discovery_threads enable row level security;
      revoke all on discovery_threads from public, anon, authenticated;
      grant select, insert, update, delete on discovery_threads to authenticated;
      create policy discovery_own on discovery_threads for all to authenticated
        using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
    `);
    // The function as it is in production today, so the migration replaces a real predecessor.
    const previous = await migration('20261004100000_0066_request_retry_integrity.sql');
    await db.exec(previous);
    await db.exec('grant execute on function public.request_conversation(uuid, text, text, timestamptz, integer, text, jsonb, uuid, text) to authenticated');
    await db.exec(await migration('20261011100000_0085_link_search_to_request.sql'));

    // Exactly one function remains, callable by signed-in users only.
    assert.equal((await one("select count(*)::int value from pg_proc where proname = 'request_conversation'")).value, 1);
    assert.equal((await one(`select has_function_privilege('authenticated', '${NEW_SIGNATURE}', 'execute') value`)).value, true);
    assert.equal((await one(`select has_function_privilege('anon', '${NEW_SIGNATURE}', 'execute') value`)).value, false);

    // Everything from here runs as a signed-in user, not as the database owner.
    await as(student);
    await db.exec('set role authenticated');

    // The old call, with no search, still works: this is what the request modal and older clients send.
    const plain = await send('Plain request', key(1));
    assert.equal(plain.title, 'Plain request');

    // Creating and editing a search still works for its owner.
    const thread = (await one("insert into discovery_threads(user_id, title, turns) values ($1, 'Finance', '[]') returning id", [student])).id;
    await db.query("update discovery_threads set turns = '[{}]', selected_person_id = $2, updated_at = now() where id = $1", [thread, mentor]);
    await db.query('update discovery_threads set archived = true where id = $1', [thread]);
    // The link is not the owner's to write, on insert or on update.
    await assert.rejects(db.query('insert into discovery_threads(user_id, title, session_id) values ($1, $2, $3)', [student, 'Forged', plain.id]), /permission denied/);
    await assert.rejects(db.query('update discovery_threads set session_id = $2 where id = $1', [thread, plain.id]), /permission denied/);
    assert.equal((await one('select session_id from discovery_threads where id = $1', [thread])).session_id, null);

    // A request sent from a search is linked to it in the same call.
    const sent = await send('From the search', key(2), thread);
    const linked = await one('select session_id, selected_person_id, archived from discovery_threads where id = $1', [thread]);
    assert.deepEqual(linked, { session_id: sent.id, selected_person_id: mentor, archived: true });

    // Replaying the same request returns the same one and leaves the link alone.
    const before = await sessions();
    assert.equal((await send('From the search', key(2), thread)).id, sent.id);
    assert.equal(await sessions(), before);
    assert.equal((await one('select session_id from discovery_threads where id = $1', [thread])).session_id, sent.id);

    // A second, different request cannot take over a search that already has one.
    await assert.rejects(send('Another request', key(3), thread), /thread_already_linked/);
    assert.equal(await sessions(), before, 'the refused request was not created');
    // Nor can replaying some other request re-point the link.
    await assert.rejects(send('Plain request', key(1), thread), /thread_already_linked/);
    assert.equal((await one('select session_id from discovery_threads where id = $1', [thread])).session_id, sent.id);

    // A request that was saved without its link (an older client) gets it on replay.
    const loose = (await one("insert into discovery_threads(user_id, title) values ($1, 'Loose') returning id", [student])).id;
    assert.equal((await send('Plain request', key(1), loose)).id, plain.id);
    assert.equal((await one('select session_id from discovery_threads where id = $1', [loose])).session_id, plain.id);

    // Someone else's search, or one that does not exist, is refused before anything is created.
    await db.exec('reset role');
    const foreign = (await one("insert into discovery_threads(user_id, title) values ($1, 'Not yours') returning id", [other])).id;
    await db.exec('set role authenticated');
    await assert.rejects(send('Using a foreign search', key(4), foreign), /thread_not_found/);
    await assert.rejects(send('Using a missing search', key(5), '50000000-0000-0000-0000-000000000000'), /thread_not_found/);
    assert.equal(await sessions(), before);
    await db.exec('reset role');
    assert.equal((await one('select session_id from discovery_threads where id = $1', [foreign])).session_id, null);

    // Deleting the request clears the link instead of leaving a dangling one.
    await db.query('delete from sessions where id = $1', [sent.id]);
    assert.equal((await one('select session_id from discovery_threads where id = $1', [thread])).session_id, null);
  } finally {
    await db.close();
  }
});
