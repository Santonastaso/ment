import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = () => readFile(new URL(
  '../supabase/migrations/20261112120000_0108_transactional_email_notifications.sql',
  import.meta.url,
), 'utf8');

const mentor = '10000000-0000-0000-0000-000000000001';
const mentee = '10000000-0000-0000-0000-000000000002';
const demo = '10000000-0000-0000-0000-000000000003';

test('first activation retires every existing row and queues only later direct messages', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text);
      create table profiles(
        id uuid primary key references auth.users(id),
        deactivated_at timestamptz,
        notification_email text,
        reflection_email_reminders boolean not null default true
      );
      create table sessions(id bigint primary key, mentor_id uuid, mentee_id uuid);
      create table session_messages(
        id bigserial primary key, session_id bigint, sender_id uuid,
        kind text not null, body text, created_at timestamptz not null default now()
      );
      create table notification_outbox(
        id bigserial primary key, user_id uuid, channel text, topic text,
        payload jsonb not null default '{}'::jsonb,
        status text not null default 'queued', idempotency_key text unique,
        created_at timestamptz not null default now(), claimed_at timestamptz,
        last_error text
      );
      insert into auth.users values
        ('${mentor}', 'mentor@essec.edu'),
        ('${mentee}', 'mentee@gmail.com'),
        ('${demo}', 'demo@ment.invalid');
      insert into profiles(id) values ('${mentor}'), ('${mentee}'), ('${demo}');
      insert into sessions values (7, '${mentor}', '${mentee}');
      insert into notification_outbox(user_id, channel, topic, idempotency_key) values
        ('${mentor}', 'email', 'reflection_reminder', 'reflection:current'),
        ('${mentee}', 'email', 'session_request_received', 'real:recent-request'),
        ('${demo}', 'email', 'session_request_received', 'demo:request');
      insert into notification_outbox(user_id, channel, topic, idempotency_key, created_at) values
        ('${mentor}', 'email', 'session_request_received', 'old:request', now() - interval '3 days');
    `);

    await db.exec(await migration());

    const preferences = await db.query('select reflection_email_reminders from profiles');
    assert.ok(preferences.rows.every(row => row.reflection_email_reminders === false));
    const backlog = await db.query('select status, last_error from notification_outbox order by id');
    assert.ok(backlog.rows.every(row => row.status === 'failed'));
    assert.ok(backlog.rows.every(row => row.last_error === 'retired_before_activation'));

    await db.query(
      'insert into session_messages(session_id, sender_id, kind, body) values ($1, $2, $3, $4)',
      [7, mentor, 'message', 'Private words must not enter the outbox'],
    );
    const queued = (await db.query("select * from notification_outbox where topic = 'session_message_received'"))
      .rows[0];
    assert.equal(queued.user_id, mentee);
    assert.deepEqual(queued.payload, { session_id: 7, message_id: 1 });
    assert.equal(JSON.stringify(queued.payload).includes('Private words'), false);

    await db.query(
      'insert into session_messages(session_id, sender_id, kind, body) values ($1, $2, $3, $4)',
      [7, mentee, 'system', 'System event'],
    );
    const count = (await db.query(
      "select count(*)::int value from notification_outbox where topic = 'session_message_received'",
    )).rows[0].value;
    assert.equal(count, 1);
  } finally {
    await db.close();
  }
});
