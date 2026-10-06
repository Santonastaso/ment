import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const viewer = '10000000-0000-0000-0000-000000000001';
const peer = '10000000-0000-0000-0000-000000000002';
const org = '20000000-0000-0000-0000-000000000001';

test('chat previews use the newest stored message without exposing unjoined groups', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create role anon; create role authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table organizations(id uuid primary key, pending_request_limit int default 10,
        incoming_request_limit int default 10, request_cooldown_days int default 7);
      create table profiles(id uuid primary key, organization_id uuid, admin_scope text default 'none',
        deactivated_at timestamptz, role text default 'alumnus');
      create table sessions(id bigint generated always as identity primary key, mentor_id uuid, mentee_id uuid,
        title text, status text, created_at timestamptz default now(), last_activity_at timestamptz default now(),
        request_expires_at timestamptz, expired_at timestamptz, accepted_at timestamptz, occurred_at timestamptz);
      create table session_messages(id bigint generated always as identity primary key, session_id bigint,
        body text, kind text, created_at timestamptz default now());
      create table groups(id bigint generated always as identity primary key, organization_id uuid,
        created_by uuid, name text, description text, created_at timestamptz default now());
      create table group_members(group_id bigint, user_id uuid, primary key(group_id, user_id));
      create table group_join_requests(group_id bigint, user_id uuid, status text, expires_at timestamptz);
      create table group_messages(id bigint generated always as identity primary key, group_id bigint,
        body text, created_at timestamptz default now());
      create function public.session_payload(public.sessions, uuid) returns jsonb language sql as
        $$ select jsonb_build_object('id', $1.id, 'title', $1.title) $$;
      create function public.is_currently_available_mentor(uuid) returns boolean language sql as $$ select true $$;
      create function public.is_active_connection(public.sessions) returns boolean language sql as
        $$ select $1.status in ('pending','scheduled') $$;
      insert into organizations(id) values ('${org}');
      insert into profiles(id, organization_id) values ('${viewer}','${org}'),('${peer}','${org}');
      insert into sessions(mentor_id, mentee_id, title, status) values ('${peer}','${viewer}','Original request','completed');
      insert into session_messages(session_id, body, kind, created_at) values
        (1,'Old reply','message',now() - interval '1 day'),
        (1,'Newest reply','message',now());
      insert into groups(organization_id, created_by, name, description) values
        ('${org}','${viewer}','Joined','Description'),('${org}','${peer}','Private','Hidden');
      insert into group_members(group_id, user_id) values (1,'${viewer}');
      insert into group_messages(group_id, body, created_at) values
        (1,'Old group reply',now() - interval '1 day'),(1,'Newest group reply',now()),
        (2,'Private message',now());
    `);
    await db.exec(await migration('20261006110000_0075_latest_chat_previews.sql'));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
    const sessions = (await db.query('select my_sessions() value')).rows[0].value;
    const groups = (await db.query('select my_groups() value')).rows[0].value;
    assert.equal(sessions[0].latest_message, 'Newest reply');
    assert.equal(groups.find(group => group.id === 1).latest_message, 'Newest group reply');
    assert.equal(groups.find(group => group.id === 2).latest_message, null);

    await db.exec(await migration('20261006111000_0076_repeat_completed_sessions.sql'));
    await db.exec('create trigger guard before insert or update on sessions for each row execute function pm_session_guard()');
    await db.query('insert into sessions(mentor_id, mentee_id, title, status) values ($1,$2,$3,$4)', [peer, viewer, 'Second request', 'pending']);
    await assert.rejects(db.query('insert into sessions(mentor_id, mentee_id, title, status) values ($1,$2,$3,$4)', [peer, viewer, 'Duplicate active request', 'pending']), /active_session_exists/);
  } finally {
    await db.close();
  }
});
