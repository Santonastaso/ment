import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('admins see fields of study and the skills they take part in, with no small counts and no people', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    // Six in Finance, five in Marketing, three in Law and two in Design (pooled: five together).
    const people = [...Array(6)].map((_, i) => [id(i + 1), 'Finance'])
      .concat([...Array(5)].map((_, i) => [id(i + 11), 'Marketing']))
      .concat([[id(21), 'Law'], [id(22), 'Law'], [id(23), 'Law'], [id(31), 'Design'], [id(32), 'Design']]);
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, organization_id uuid, name text, department text,
        admin_scope text default 'none', deactivated_at timestamptz, role text default 'student');
      insert into profiles(id, organization_id, name, department, admin_scope) values ('${admin}', '${org}', 'Admin', '', 'org');
      insert into profiles(id, organization_id, name, department) values
        ${people.map(([pid, field], i) => `('${pid}', '${org}', 'Person ${i}', '${field}')`).join(',')};
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      insert into skills(user_id, skill, type) values
        ('${id(1)}', 'Valuation', 'can_teach'), ('${id(11)}', 'Valuation', 'wants_to_learn'), ('${id(21)}', 'valuation', 'wants_to_learn'),
        ('${id(12)}', 'Brand strategy', 'can_teach');
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text, topics jsonb);
      insert into sessions(mentor_id, mentee_id, status, topics) values
        ('${id(1)}', '${id(12)}', 'completed', '["Valuation"]'), ('${id(2)}', '${id(13)}', 'declined', '["Brand strategy"]');
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
    `);
    // Six alumni, ten students.
    await db.exec(`update profiles set role = 'alumnus' where department in ('Finance')`);
    await db.exec(await migration('20261022100000_0092_admin_fields_of_study.sql'));
    assert.equal((await one("select has_function_privilege('anon', 'public.admin_fields_of_study(integer)', 'execute') value")).value, false);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(1)]);
    await assert.rejects(db.query('select admin_fields_of_study()'), /admin_only/);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const result = (await one('select admin_fields_of_study() value')).value;
    assert.deepEqual([result.students, result.alumni], [10, 6]);
    assert.deepEqual(result.fields, [
      { field: 'Finance', members: 6, active: true },
      { field: 'Marketing', members: 5, active: true },
      { field: null, members: 5, active: false },
    ]);
    const valuation = result.skills.find(s => s.skill.toLowerCase() === 'valuation');
    assert.deepEqual(valuation.offered, ['Finance']);
    assert.deepEqual([...valuation.wanted].sort(), ['Marketing', null].sort());
    assert.deepEqual([...valuation.sessions].sort(), ['Finance', 'Marketing']);
    // A declined session is not participation.
    assert.deepEqual(result.skills.find(s => s.skill === 'Brand strategy').sessions, []);
    // No names, ids or counts per skill leave the database.
    const text = JSON.stringify(result);
    assert.ok(!/Person \d|10000000-/.test(text));
    assert.ok(result.skills.every(s => Object.keys(s).sort().join() === 'offered,sessions,skill,wanted'));
    // Valuation (4 rows) ranks above Brand strategy (2).
    assert.equal(result.skills[0].skill, 'Valuation');
  } finally {
    await db.close();
  }
});

test('a pool of other fields smaller than five is left out entirely', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, organization_id uuid, name text, department text, admin_scope text default 'none', deactivated_at timestamptz, role text default 'student');
      insert into profiles(id, organization_id, department, admin_scope) values ('${admin}', '${org}', '', 'org');
      insert into profiles(id, organization_id, department) values
        ${[...Array(5)].map((_, i) => `('${id(i + 1)}', '${org}', 'Finance')`).join(',')}, ('${id(9)}', '${org}', 'Law');
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      insert into skills(user_id, skill, type) values ('${id(9)}', 'Contract law', 'can_teach');
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text, topics jsonb);
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
      select set_config('request.jwt.claim.sub', '${admin}', false);
    `);
    await db.exec(await migration('20261022100000_0092_admin_fields_of_study.sql'));
    const result = (await one('select admin_fields_of_study() value')).value;
    assert.deepEqual(result.fields.map(f => f.field), ['Finance']);
    // Six students, no alumni: the alumni count is not shown below five.
    assert.deepEqual([result.students, result.alumni], [6, null]);
    // The one Law student is in no group that is shown, so their skill is not either.
    assert.deepEqual(result.skills, []);
  } finally {
    await db.close();
  }
});
