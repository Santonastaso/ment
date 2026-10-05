import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const owner = '10000000-0000-0000-0000-000000000001';
const outsider = '10000000-0000-0000-0000-000000000002';

test('session history RPC reads messages hidden by direct table RLS', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table sessions(id bigint primary key, mentor_id uuid, mentee_id uuid);
      create table session_messages(id bigint primary key, session_id bigint, sender_id uuid,
        kind text, body text, created_at timestamptz);
      insert into sessions values (1, '${owner}', '${outsider}');
      insert into session_messages values (1, 1, '${owner}', 'message', 'Stored reply', now());
      alter table sessions enable row level security;
      grant select on sessions to authenticated;
    `);
    const sql = await migration('20260909110000_0037_conversations_and_capacity.sql');
    await db.exec(sql.slice(sql.indexOf('alter table public.session_messages enable row level security'),
      sql.indexOf('insert into public.session_messages(session_id, sender_id, kind, body, created_at)')));
    await db.exec(sql.slice(sql.indexOf('create or replace function public.my_session_messages'),
      sql.indexOf('create or replace function public.send_session_message')));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int value from session_messages')).rows[0].value, 0);
    const history = (await db.query('select my_session_messages(1) value')).rows[0].value;
    assert.equal(history[0].body, 'Stored reply');
  } finally {
    await db.close();
  }
});

test('group history pages backwards and rejects non-members', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, name text not null);
      create table group_members(group_id bigint, user_id uuid);
      create table group_messages(id bigserial primary key, group_id bigint, sender_id uuid, body text, created_at timestamptz default now());
      create function public.my_group_messages(bigint, integer) returns jsonb language sql as $$ select '[]'::jsonb $$;
      insert into profiles values ('${owner}', 'Owner');
      insert into group_members values (1, '${owner}');
      insert into group_messages(group_id, sender_id, body)
        select 1, '${owner}', 'Message ' || n from generate_series(1, 55) n;
    `);
    await db.exec(await migration('20261002110000_0064_group_message_pagination.sql'));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    const first = (await db.query('select my_group_messages(1, 50) value')).rows[0].value;
    assert.equal(first.messages.length, 50);
    assert.equal(first.messages[0].id, 6);
    assert.equal(first.hasMore, true);
    const older = (await db.query('select my_group_messages(1, 50, $1) value', [first.messages[0].id])).rows[0].value;
    assert.deepEqual(older.messages.map(row => row.id), [1, 2, 3, 4, 5]);
    assert.equal(older.hasMore, false);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [outsider]);
    await assert.rejects(db.query('select my_group_messages(1, 50) value'), /not_a_member/);
  } finally {
    await db.close();
  }
});

test('profile, skill, and career changes atomically mark matches stale', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table profiles(
        id uuid primary key, name text default '', department text default '', seniority text default '',
        job_title text default '', bio text default '', program text default '', cohort_year integer,
        location text default '', working_language text default '', matches_stale boolean default false
      );
      create table skills(id bigserial primary key, user_id uuid, skill text);
      create table career_history(id bigserial primary key, user_id uuid, role_title text);
      insert into profiles(id) values ('${owner}');
    `);
    await db.exec(await migration('20261002111000_0065_atomic_match_invalidation.sql'));
    const stale = async () => (await db.query('select matches_stale from profiles where id = $1', [owner])).rows[0].matches_stale;
    await db.query('update profiles set job_title = $1 where id = $2', ['Engineer', owner]);
    assert.equal(await stale(), true);
    await db.query('update profiles set matches_stale = false where id = $1', [owner]);
    assert.equal(await stale(), false);
    await db.query('insert into skills(user_id, skill) values ($1, $2)', [owner, 'React']);
    assert.equal(await stale(), true);
    await db.query('update profiles set matches_stale = false where id = $1', [owner]);
    await db.query('insert into career_history(user_id, role_title) values ($1, $2)', [owner, 'Lead']);
    assert.equal(await stale(), true);
    await db.query('update profiles set matches_stale = false where id = $1', [owner]);
    await db.query('delete from skills where user_id = $1', [owner]);
    assert.equal(await stale(), true);
  } finally {
    await db.close();
  }
});
