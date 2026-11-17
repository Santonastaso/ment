import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = readFile(new URL('../supabase/migrations/20261116214352_peer_conversation_history.sql', import.meta.url), 'utf8');
const viewer = '10000000-0000-0000-0000-000000000001';
const peer = '10000000-0000-0000-0000-000000000002';
const other = '10000000-0000-0000-0000-000000000003';

test('peer history stays continuous and archiving is private and reversible', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key);
      create table sessions(
        id bigint generated always as identity primary key,
        mentor_id uuid not null references profiles(id), mentee_id uuid not null references profiles(id),
        title text, status text default 'completed', created_at timestamptz default now(),
        last_activity_at timestamptz default now(), request_expires_at timestamptz, expired_at timestamptz
      );
      create table session_messages(
        id bigint generated always as identity primary key, session_id bigint references sessions(id),
        sender_id uuid, kind text default 'message', body text, client_id uuid, created_at timestamptz default now()
      );
      create table session_reads(
        session_id bigint references sessions(id), user_id uuid references profiles(id),
        last_read_at timestamptz default now(), primary key(session_id, user_id)
      );
      create function public.is_active_user() returns boolean language sql stable as $$ select auth.uid() is not null $$;
      create function public.session_payload(public.sessions, uuid) returns jsonb language sql stable as
        $$ select jsonb_build_object('id', $1.id, 'mentor_id', $1.mentor_id, 'mentee_id', $1.mentee_id,
          'title', $1.title, 'status', $1.status, 'created_at', $1.created_at, 'last_activity_at', $1.last_activity_at) $$;
      insert into profiles(id) values ('${viewer}'), ('${peer}'), ('${other}');
      insert into sessions(mentor_id, mentee_id, title, last_activity_at) values
        ('${peer}', '${viewer}', 'First', now() - interval '2 days'),
        ('${peer}', '${viewer}', 'Second', now() - interval '1 day'),
        ('${other}', '${viewer}', 'Other', now());
      insert into session_messages(session_id, sender_id, body) values
        (1, '${viewer}', 'First session'), (2, '${peer}', 'Second session'), (3, '${other}', 'Other person');
    `);
    await db.exec(await migration);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);

    const history = (await db.query('select my_session_messages(1) value')).rows[0].value;
    assert.deepEqual(history.messages.map(message => message.body), ['First session', 'Second session']);

    await db.query('select set_peer_conversation_archived(1, true)');
    let sessions = (await db.query('select my_sessions() value')).rows[0].value;
    assert.equal(sessions.find(session => session.id === 1).conversation_archived, true);
    assert.equal(sessions.find(session => session.id === 2).conversation_archived, true);
    assert.equal(sessions.find(session => session.id === 3).conversation_archived, false);

    await db.query("update sessions set last_activity_at = now() + interval '1 second' where id = 2");
    sessions = (await db.query('select my_sessions() value')).rows[0].value;
    assert.equal(sessions.find(session => session.id === 1).conversation_archived, false);

    await db.query('select mark_session_read(1)');
    assert.equal((await db.query('select count(*)::int value from session_reads')).rows[0].value, 2);

    await db.query('select set_peer_conversation_archived(1, true)');
    await db.query('select set_peer_conversation_archived(1, false)');
    assert.equal((await db.query('select count(*)::int value from peer_conversation_preferences')).rows[0].value, 0);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    await assert.rejects(db.query('select my_session_messages(1)'), /not_found/);
  } finally {
    await db.close();
  }
});
