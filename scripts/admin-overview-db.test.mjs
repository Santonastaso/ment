import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('the programme overview: headline, funnel and alumni to recruit, nothing under five', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    const rows = [];
    // 20 onboarded students (6 joined this month), 3 without a profile yet.
    for (let i = 0; i < 23; i += 1) rows.push([id(i), 'student', i < 20, i < 6 ? "now() - interval '3 days'" : "now() - interval '200 days'", true]);
    // 10 alumni available, 2 paused.
    for (let i = 0; i < 12; i += 1) rows.push([id(100 + i), 'alumnus', true, "now() - interval '200 days'", i < 10]);
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key, email text);
      create table profiles(id uuid primary key, organization_id uuid, role text, onboarding_complete boolean, created_at timestamptz,
        admin_scope text default 'none', deactivated_at timestamptz, available boolean default true);
      insert into profiles(id, organization_id, role, onboarding_complete, created_at, admin_scope) values ('${admin}', '${org}', 'student', true, now(), 'org');
      insert into profiles(id, organization_id, role, onboarding_complete, created_at, available) values
        ${rows.map(([pid, role, done, created, available]) => `('${pid}', '${org}', '${role}', ${done}, ${created}, ${available})`).join(',')};
      insert into auth.users select id, id::text || '@example.test' from profiles;
      create table invitations(id bigserial primary key, organization_id uuid, email text);
      insert into invitations(organization_id, email) values ${[...Array(5)].map((_, i) => `('${org}', 'invited${i}@example.test')`).join(',')}, ('${org}', '${id(0)}@example.test');
      create table outreach_targets(id bigserial primary key, organization_id uuid, email text);
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      insert into skills(user_id, skill, type)
        select id, 'Python', 'wants_to_learn' from profiles where role = 'student' and id <> '${admin}' order by id limit 8;
      insert into skills(user_id, skill, type) values ('${id(100)}', 'python', 'can_teach'), ('${id(110)}', 'Python', 'can_teach');
      insert into skills(user_id, skill, type)
        select id, 'Valuation', 'wants_to_learn' from profiles where role = 'student' and id <> '${admin}' order by id limit 6;
      insert into skills(user_id, skill, type)
        select id, 'Valuation', 'can_teach' from profiles where role = 'alumnus' and available order by id limit 6;
      insert into skills(user_id, skill, type)
        select id, 'SQL', 'wants_to_learn' from profiles where role = 'student' and id <> '${admin}' order by id limit 4;
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text, created_at timestamptz default now(),
        accepted_at timestamptz, occurred_at timestamptz, mentor_completed_at timestamptz, mentee_completed_at timestamptz);
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
      create function is_currently_available_mentor(uuid) returns boolean language sql stable as $$ select available from profiles where id = $1 $$;
    `);
    // 12 completed meetings between ten alumni and twelve students, six of them this month.
    for (let i = 0; i < 12; i += 1) {
      await db.query(`insert into sessions(mentor_id, mentee_id, status, created_at, accepted_at, occurred_at) values ($1, $2, 'completed', now() - interval '60 days', now() - interval '59 days', now() - make_interval(days => $3))`,
        [id(100 + (i % 10)), id(i), i < 6 ? 5 : 50]);
    }
    // Eight more requests in the last 90 days that were never accepted.
    for (let i = 0; i < 8; i += 1) await db.query(`insert into sessions(mentor_id, mentee_id, status, created_at) values ($1, $2, 'declined', now() - interval '10 days')`, [id(100 + i), id(12 + i)]);
    await db.exec(await migration('20261025100000_0094_admin_programme_overview.sql'));

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(1)]);
    await assert.rejects(db.query('select admin_programme_overview()'), /admin_only/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const r = (await one('select admin_programme_overview() value')).value;

    assert.deepEqual(r.headline, {
      students: 20, students_new: 6, alumni_available: 10, alumni_new: null,
      meetings: 12, meetings_new: 6, acceptance_rate: 60, requests: 20,
    });
    assert.deepEqual(r.funnel, [
      { step: 'invited', count: 40 }, { step: 'joined', count: 35 }, { step: 'profile', count: 32 },
      { step: 'talking', count: 30 }, { step: 'met', count: 22 },
    ]);
    // Python: eight want it, two available alumni offer it (shown as fewer than five).
    // Valuation is covered; SQL has too few people wanting it to report.
    assert.deepEqual(r.recruit, [{ skill: 'Python', wanted: 8, offered: null }]);
    assert.equal((await one("select reportable(4) a, reportable(5) b")).a, null);
  } finally {
    await db.close();
  }
});
