import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('the admin overview groups by programme and merges spellings of a skill', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key, email text);
      create table organizations(id uuid primary key, name text, type text default 'intra');
      create table profiles(id uuid primary key, organization_id uuid, program text, department text default 'Finance', role text default 'student',
        onboarding_complete boolean default true, created_at timestamptz default now() - interval '200 days',
        admin_scope text default 'none', deactivated_at timestamptz, working_language text default 'en');
      insert into profiles(id, organization_id, admin_scope) values ('${admin}', '${org}', 'org');
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text, topics jsonb default '[]',
        created_at timestamptz default now(), accepted_at timestamptz, occurred_at timestamptz, mentor_completed_at timestamptz, mentee_completed_at timestamptz);
      create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid, status text);
      create table invitations(id bigserial primary key, organization_id uuid, email text);
      create table outreach_targets(id bigserial primary key, organization_id uuid, email text);
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
      create function is_currently_available_mentor(uuid) returns boolean language sql stable as $$ select true $$;
      create function admin_scope_for(uuid) returns text language sql stable as $$ select admin_scope from profiles where id = $1 $$;
      create function reportable(n bigint) returns integer language sql immutable as $$ select case when n >= 5 then n::int end $$;
    `);
    // Six MiM students (all in Finance), five MSc in Finance alumni (all in Marketing): grouping must follow the programme.
    for (let i = 0; i < 6; i += 1) await db.query("insert into profiles(id, organization_id, program, department) values ($1, $2, 'MiM', 'Finance')", [id(i), org]);
    for (let i = 0; i < 5; i += 1) await db.query("insert into profiles(id, organization_id, program, department, role) values ($1, $2, 'MSc in Finance', 'Marketing', 'alumnus')", [id(100 + i), org]);
    await db.exec("insert into auth.users select id, id::text || '@example.test' from profiles");
    // Students want ERP in three spellings; alumni offer valuation in two.
    const spellings = ['ERP systems', 'erp system', 'ERP systems.', 'ERP Systems', 'ERP systems', 'erp systems'];
    for (let i = 0; i < 6; i += 1) await db.query("insert into skills(user_id, skill, type) values ($1, $2, 'wants_to_learn')", [id(i), spellings[i]]);
    for (let i = 0; i < 5; i += 1) await db.query("insert into skills(user_id, skill, type) values ($1, $2, 'can_teach')", [id(100 + i), i % 2 ? 'valuations' : 'Valuation']);
    await db.exec(await migration('20261031100000_0096_knowledge_graph_programmes.sql'));
    await db.exec(await migration('20261101100000_0097_admin_overview_by_programme.sql'));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);

    const fields = (await one('select admin_fields_of_study() value')).value;
    assert.deepEqual(fields.fields.map(f => [f.field, f.members]), [['MiM', 6], ['MSc in Finance', 5]]);
    const erp = fields.skills.find(s => /erp/i.test(s.skill));
    assert.equal(erp.skill, 'ERP systems', 'spellings merged, the most common one names it');
    assert.deepEqual(erp.wanted, ['MiM']);
    assert.deepEqual(fields.skills.find(s => /valuation/i.test(s.skill)).offered, ['MSc in Finance']);

    const overview = (await one('select admin_programme_overview() value')).value;
    assert.deepEqual(overview.recruit, [{ skill: 'ERP systems', wanted: 6, offered: null }]);
  } finally {
    await db.close();
  }
});
