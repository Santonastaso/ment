import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('the admin dashboard gets departments and trends, never a named or traceable person', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    // Six people in Finance, two in Legal (too few to show on their own).
    const people = [...Array(6)].map((_, i) => [id(i + 1), `Finance Person ${i + 1}`, 'Finance'])
      .concat([[id(7), 'Legal Person 1', 'Legal'], [id(8), 'Legal Person 2', 'Legal']]);
    await db.exec(`
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table organizations(id uuid primary key, name text, type text);
      insert into organizations values ('${org}', 'ESSEC', 'intra');
      create table profiles(id uuid primary key, organization_id uuid, name text, department text, job_title text default 'Analyst',
        location text default 'Paris', seniority text default 'junior', working_language text default 'en', program text default 'MiM',
        cohort_year int default 2024, role text default 'student', admin_scope text default 'none', deactivated_at timestamptz,
        onboarding_complete boolean default true);
      insert into profiles(id, organization_id, name, department, admin_scope) values ('${admin}', '${org}', 'Admin', '', 'org');
      insert into profiles(id, organization_id, name, department) values
        ${people.map(([pid, name, dept]) => `('${pid}', '${org}', '${name}', '${dept}')`).join(',')};
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      insert into skills(user_id, skill, type) values ('${id(1)}', 'Valuation', 'can_teach'), ('${id(7)}', 'Valuation', 'wants_to_learn');
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text);
      insert into sessions(mentor_id, mentee_id, status) values ('${id(1)}', '${id(7)}', 'completed'), ('${id(1)}', '${id(2)}', 'scheduled');
      create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid, status text);
      create table match_scores(id bigserial primary key, user_a_id uuid, user_b_id uuid);
      create function admin_scope_for(uuid) returns text language sql stable as $$ select admin_scope from profiles where id = $1 $$;
      create function is_admin(uuid) returns boolean language sql stable as $$ select admin_scope <> 'none' from profiles where id = $1 $$;
      create function is_platform_admin(uuid) returns boolean language sql stable as $$ select false $$;
      create function current_organization_id(uuid) returns uuid language sql stable as $$ select organization_id from profiles where id = $1 $$;
      create function most_active_users(p_limit int default 10) returns jsonb language sql as $$ select '[]'::jsonb $$;
      select set_config('request.jwt.claim.sub', '${admin}', false);
    `);
    await db.exec(await migration('20261019120000_0088_admin_dashboard_without_names.sql'));

    const graph = (await one('select knowledge_graph() value')).value;
    const text = JSON.stringify(graph);
    for (const [pid, name] of people) {
      assert.ok(!text.includes(pid), 'no profile id');
      assert.ok(!text.includes(name), 'no name');
    }
    for (const field of ['label', 'job_title', 'location', 'seniority']) {
      assert.ok(graph.nodes.filter(n => n.kind === 'person').every(n => !(field in n)), field);
    }
    const persons = graph.nodes.filter(n => n.kind === 'person');
    assert.equal(persons.length, 8);
    assert.deepEqual([...new Set(persons.map(n => n.department))].sort(), ['Finance', null]);
    // Edges still connect the right nodes inside one response.
    const session = graph.edges.find(e => e.type === 'session');
    assert.ok(persons.some(n => n.id === session.source) && persons.some(n => n.id === session.target));
    assert.ok(graph.edges.some(e => e.target === 's:valuation' && e.type === 'can_teach'));
    // A second call draws new ids, so an id cannot be followed across calls.
    const teacher = r => r.edges.find(e => e.type === 'can_teach').source;
    const seen = new Set([teacher(graph)]);
    for (let call = 0; call < 12; call += 1) seen.add(teacher((await one('select knowledge_graph() value')).value));
    assert.ok(seen.size > 1, 'the same person gets different ids from call to call');

    const stats = (await one('select admin_stats() value')).value;
    assert.ok(!('topMentors' in stats));
    assert.ok(!JSON.stringify(stats).includes('Person'));
    assert.deepEqual(stats.departmentParticipation, [
      { department: 'Finance', members: 6, active_members: 2, mentors_active: 1 },
      { department: null, members: 2, active_members: 1, mentors_active: 0 },
    ]);
    assert.deepEqual(stats.deptActivity.map(d => [d.department, d.session_count]).sort(), [['Finance', 1], [null, 1]].sort());
    assert.equal(stats.totalUsers, 8);
    assert.equal((await one("select count(*)::int n from pg_proc where proname = 'most_active_users'")).n, 0);
  } finally {
    await db.close();
  }
});
