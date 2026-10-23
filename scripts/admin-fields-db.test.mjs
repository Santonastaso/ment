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
    const declarations = [
      ...[1, 2, 3, 4, 5].map(n => [n, 'Valuation', 'can_teach']),
      ...[11, 12, 13, 14, 15].map(n => [n, 'Valuation', 'wants_to_learn']),
      ...[21, 22, 23, 31, 32].map(n => [n, 'Design thinking', 'can_teach']),
      ...[1, 2, 3, 4].map(n => [n, 'Rare skill', 'wants_to_learn']),
      ...Array(6).fill([1, 'Duplicate skill', 'can_teach']),
      [12, 'Brand strategy', 'can_teach'],
    ];
    const completed = [1, 2, 3, 4, 5].map((n, i) => [n, i + 11, 'completed', 'Valuation']);
    const scheduled = [21, 22, 23, 31, 32].map((n, i) => [n, i + 11, 'scheduled', 'Pending topic']);
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
        ${declarations.map(([n, skill, type]) => `('${id(n)}', '${skill}', '${type}')`).join(',')};
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text, topics jsonb);
      insert into sessions(mentor_id, mentee_id, status, topics) values
        ${completed.concat(scheduled).map(([mentor, mentee, status, topic]) => `('${id(mentor)}', '${id(mentee)}', '${status}', '["${topic}"]')`).join(',')},
        ('${id(2)}', '${id(13)}', 'declined', '["Brand strategy"]');
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
    `);
    // Six alumni, ten students.
    await db.exec(`update profiles set role = 'alumnus' where department in ('Finance')`);
    await db.exec(await migration('20261022100000_0092_admin_fields_of_study.sql'));
    await db.exec(await migration('20261023100000_0093_admin_fields_reporting_thresholds.sql'));
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
    assert.deepEqual(valuation.wanted, ['Marketing']);
    assert.deepEqual([...valuation.sessions].sort(), ['Finance', 'Marketing']);
    assert.deepEqual(result.skills.find(s => s.skill === 'Design thinking').offered, [null]);
    // Four distinct members, duplicate rows from one member, scheduled and
    // declined sessions cannot create a reportable skill or relationship.
    for (const skill of ['Rare skill', 'Duplicate skill', 'Pending topic', 'Brand strategy']) {
      assert.ok(!result.skills.some(s => s.skill === skill), `${skill} must stay hidden`);
    }
    // No names, ids or counts per skill leave the database.
    const text = JSON.stringify(result);
    assert.ok(!/Person \d|10000000-/.test(text));
    assert.ok(result.skills.every(s => Object.keys(s).sort().join() === 'offered,sessions,skill,wanted'));
    // Ranking includes reportable cells only.
    assert.equal(result.skills[0].skill, 'Valuation');

    // Repeated meetings by one pooled member do not establish a relationship
    // or make that field look active.
    await db.exec(`insert into sessions(mentor_id, mentee_id, status, topics) values
      ${Array(6).fill(`('${id(21)}', '${id(11)}', 'completed', '["Repeat topic"]')`).join(',')}`);
    const repeated = (await one('select admin_fields_of_study() value')).value;
    assert.equal(repeated.fields.find(f => f.field === null).active, false);
    assert.ok(!repeated.skills.some(s => s.skill === 'Repeat topic'));

    // Four completed participants per field are still below the threshold.
    await db.query("update sessions set status = 'scheduled' where mentor_id = $1 and topics = '[\"Valuation\"]'::jsonb", [id(5)]);
    const fourMeetings = (await one('select admin_fields_of_study() value')).value;
    assert.equal(fourMeetings.fields.find(f => f.field === 'Finance').active, false);
    assert.equal(fourMeetings.fields.find(f => f.field === 'Marketing').active, false);
    assert.deepEqual(fourMeetings.skills.find(s => s.skill === 'Valuation').sessions, []);
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
    await db.exec(await migration('20261023100000_0093_admin_fields_reporting_thresholds.sql'));
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
