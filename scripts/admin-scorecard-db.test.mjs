import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('the scorecard: new connections, cross-field share, benefit, capacity and reply time', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    // Finance: alumni 1-6, students 11-16. Marketing: students 21-26.
    const people = [];
    for (let i = 1; i <= 6; i += 1) people.push([id(i), 'alumnus', 'Finance']);
    for (let i = 11; i <= 16; i += 1) people.push([id(i), 'student', 'Finance']);
    for (let i = 21; i <= 26; i += 1) people.push([id(i), 'student', 'Marketing']);
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, organization_id uuid, role text, department text, onboarding_complete boolean default true,
        monthly_meeting_limit integer default 4, admin_scope text default 'none', deactivated_at timestamptz);
      insert into profiles(id, organization_id, role, department, admin_scope) values ('${admin}', '${org}', 'student', '', 'org');
      insert into profiles(id, organization_id, role, department) values ${people.map(([pid, role, field]) => `('${pid}', '${org}', '${role}', '${field}')`).join(',')};
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text, created_at timestamptz default now(),
        accepted_at timestamptz, scheduled_at timestamptz, occurred_at timestamptz, mentor_completed_at timestamptz, mentee_completed_at timestamptz);
      create table session_messages(id bigserial primary key, session_id bigint, sender_id uuid, kind text default 'message', created_at timestamptz default now());
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
      create function is_currently_available_mentor(uuid) returns boolean language sql stable as $$ select true $$;
      create function reportable(n bigint) returns integer language sql immutable as $$ select case when n >= 5 then n::int end $$;
    `);
    // Six cross-field meetings this month (Finance alumni with Marketing students) and
    // five within Finance two months ago; each accepted after 1..11 hours.
    for (let i = 0; i < 6; i += 1) {
      await db.query(`insert into sessions(mentor_id, mentee_id, status, created_at, accepted_at, occurred_at) values ($1, $2, 'completed', now() - interval '10 days', now() - interval '10 days' + make_interval(hours => $3), now() - interval '5 days')`, [id(1 + i), id(21 + i), 1 + i * 2]);
    }
    for (let i = 0; i < 5; i += 1) {
      await db.query(`insert into sessions(mentor_id, mentee_id, status, created_at, accepted_at, occurred_at) values ($1, $2, 'completed', now() - interval '70 days', now() - interval '69 days', now() - interval '60 days')`, [id(1 + i), id(11 + i)]);
    }
    await db.exec(await migration('20261031100000_0096_admin_scorecard.sql'));

    // A student records whether the meeting helped; the alumnus cannot, nor for a meeting not held.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(21)]);
    assert.deepEqual((await one("select record_meeting_benefit(1, 'yes') value")).value, { answer: 'yes' });
    await assert.rejects(db.query("select record_meeting_benefit(1, 'maybe')"), /invalid_answer/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(1)]);
    await assert.rejects(db.query("select record_meeting_benefit(1, 'yes')"), /not_allowed/);
    await db.exec(`insert into meeting_benefits(session_id, user_id, answer) values
      (2, '${id(22)}', 'yes'), (3, '${id(23)}', 'yes'), (4, '${id(24)}', 'somewhat'), (5, '${id(25)}', 'no'), (6, '${id(26)}', 'yes')`);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(11)]);
    await assert.rejects(db.query('select admin_scorecard()'), /admin_only/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const r = (await one('select admin_scorecard() value')).value;
    assert.deepEqual(r, {
      new_connections_30d: 6,
      cross_field_share: 55, cross_field_pairs: 1,
      benefit_rate: 67, benefit_answers: 6,
      capacity_used: 25,
      median_reply_hours: 11,
    });
  } finally {
    await db.close();
  }
});
