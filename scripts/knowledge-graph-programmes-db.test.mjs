import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-0000000000aa';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('the knowledge graph groups by programme, links skills offered together, and shows nothing under five', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  // 8 in MiM, 7 in MiF, 6 in SMIB; 3 in BBA and 3 without a programme are pooled (6).
  const people = [];
  const add = (count, program, start) => { for (let i = 0; i < count; i += 1) people.push([id(start + i), program]); };
  add(8, 'MiM', 0); add(7, 'MiF', 100); add(6, 'SMIB', 200); add(3, 'BBA', 300); add(3, null, 400);
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table organizations(id uuid primary key, name text, type text default 'intra');
      insert into organizations values ('${org}', 'ESSEC');
      create table profiles(id uuid primary key, organization_id uuid, name text default 'Someone', program text, department text default 'Finance',
        admin_scope text default 'none', deactivated_at timestamptz, working_language text default 'en');
      insert into profiles(id, organization_id, admin_scope) values ('${admin}', '${org}', 'org');
      insert into profiles(id, organization_id, program) values ${people.map(([pid, program]) => `('${pid}', '${org}', ${program ? `'${program}'` : 'null'})`).join(',')};
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, status text);
      create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid, status text);
      create function admin_scope_for(uuid) returns text language sql stable as $$ select admin_scope from profiles where id = $1 $$;
    `);
    const skill = (pid, name, type = 'can_teach') => db.query('insert into skills(user_id, skill, type) values ($1, $2, $3)', [pid, name, type]);
    // Six MiM and five MiF offer modelling (three spellings) and valuation.
    for (let i = 0; i < 6; i += 1) { await skill(id(i), i % 2 ? 'Financial Modeling' : 'financial modelling'); await skill(id(i), 'Valuation'); }
    for (let i = 0; i < 5; i += 1) { await skill(id(100 + i), 'Financial modelling.'); await skill(id(100 + i), 'valuations'); }
    // Five SMIB want Python; only two BBA offer negotiation (too few to show).
    for (let i = 0; i < 5; i += 1) await skill(id(200 + i), 'Python', 'wants_to_learn');
    await skill(id(300), 'Negotiation'); await skill(id(301), 'Negotiation');
    // Three completed meetings MiM <-> MiF: six people.
    for (let i = 0; i < 3; i += 1) await db.query("insert into sessions(mentor_id, mentee_id, status) values ($1, $2, 'completed')", [id(i), id(100 + i)]);
    await db.exec(await migration('20261031100000_0095_knowledge_graph_programmes.sql'));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const graph = (await one('select knowledge_graph() value')).value;
    const programs = graph.nodes.filter(n => n.kind === 'program');
    assert.deepEqual(programs.map(n => [n.label, n.count]).sort(), [['MiF', 7], ['MiM', 8], ['SMIB', 6], [null, 6]].sort());
    const skills = graph.nodes.filter(n => n.kind === 'skill');
    // Spellings merged; the most common one names the skill.
    assert.deepEqual(skills.map(n => n.label).sort(), ['Financial modelling', 'Python', 'Valuation'].sort());
    assert.equal(skills.find(n => n.label === 'Financial modelling').teachers, 11);
    assert.ok(!skills.some(n => /negotiation/i.test(n.label)), 'two people are not enough');
    const label = nodeId => graph.nodes.find(n => n.id === nodeId)?.label;
    const byType = type => graph.edges.filter(e => e.type === type).map(e => [label(e.source), label(e.target), e.count]);
    assert.deepEqual(byType('skill_link').map(([a, b, c]) => [[a, b].sort().join(' + '), c]), [['Financial modelling + Valuation', 11]]);
    assert.deepEqual(byType('can_teach').sort(), [['MiF', 'Valuation', 5], ['MiF', 'Financial modelling', 5], ['MiM', 'Valuation', 6], ['MiM', 'Financial modelling', 6]].sort());
    assert.deepEqual(byType('wants_to_learn'), [['SMIB', 'Python', 5]]);
    assert.deepEqual(byType('session').map(([a, b, c]) => [[a, b].sort().join('-'), c]), [['MiF-MiM', 6]]);
    // No person, name or profile id leaves the database.
    const text = JSON.stringify(graph);
    assert.ok(!text.includes('10000000-') && !text.includes('Someone'));
    assert.equal((await one("select normalize_skill('Data Analyses') v")).v, 'data analyse');
    assert.equal((await one("select normalize_skill('Data analysis') v")).v, 'data analysis');
    assert.equal((await one("select normalize_skill('M&A') v")).v, 'm&a');
  } finally {
    await db.close();
  }
});
