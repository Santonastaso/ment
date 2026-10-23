import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001';
const admin = '20000000-0000-0000-0000-000000000000';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('the demo seed fills the field-links view, touches only demo accounts, and can be removed', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const fields = ['Finance', 'Marketing', 'Operations', 'Consulting', 'Engineering', 'Human Resources', 'Sustainability', 'Sales', 'Design'];
  const people = [];
  fields.forEach((field, f) => { for (let i = 0; i < 8; i += 1) people.push({ id: id(f * 100 + i), field, role: i < 4 ? 'alumnus' : 'student', email: `demo-${f}-${i}@ment.invalid` }); });
  people.push({ id: id(999), field: 'Finance', role: 'student', email: 'real.person@gmail.com' });
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key, email text);
      create table organizations(id uuid primary key, name text, slug text, type text default 'intra');
      insert into organizations values ('${org}', 'MENT Demo', 'ment-demo');
      create table profiles(id uuid primary key, organization_id uuid, name text default '', department text, role text,
        admin_scope text default 'none', deactivated_at timestamptz, onboarding_complete boolean default true, working_language text default 'en');
      insert into profiles(id, organization_id, admin_scope, department) values ('${admin}', '${org}', 'org', '');
      insert into auth.users values ${people.map(p => `('${p.id}', '${p.email}')`).join(',')};
      insert into profiles(id, organization_id, department, role) values ${people.map(p => `('${p.id}', '${org}', '${p.field}', '${p.role}')`).join(',')};
      create table skills(id bigserial primary key, user_id uuid, skill text, type text);
      insert into skills(user_id, skill, type) select id, 'Skill of ' || department, 'can_teach' from profiles where role = 'alumnus';
      create table sessions(id bigserial primary key, mentor_id uuid, mentee_id uuid, title text, status text, topics jsonb default '[]',
        created_at timestamptz default now(), accepted_at timestamptz, scheduled_at timestamptz, occurred_at timestamptz,
        mentee_completed_at timestamptz, mentor_completed_at timestamptz, last_activity_at timestamptz default now(),
        route_token text not null default md5(random()::text));
      create table connections(id bigserial primary key, requester_id uuid, addressee_id uuid, status text);
      create function is_currently_available_mentor(uuid) returns boolean language sql stable as $$ select true $$;
      -- Stands in for the production request guard: this alumnus has too many open requests.
      create function refuse_busy() returns trigger language plpgsql as $$ begin
        if new.mentor_id = '${id(0)}' and new.title like '[Demo] %' then raise exception 'recipient_pending_limit'; end if; return new; end $$;
      create trigger refuse_busy before insert on sessions for each row execute function refuse_busy();
      create function admin_scope_for(uuid) returns text language sql stable as $$ select admin_scope from profiles where id = $1 $$;
    `);
    const migration = await file('supabase/migrations/20261020100000_0090_aggregate_admin_reporting.sql');
    const graphFunction = migration.slice(migration.indexOf('create or replace function public.knowledge_graph('), migration.indexOf('$$;', migration.indexOf('create or replace function public.knowledge_graph(')) + 3);
    await db.exec(graphFunction);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const links = async () => (await one('select knowledge_graph() value')).value.edges.filter(e => e.type === 'session');

    assert.equal((await links()).length, 0, 'empty before');
    await db.exec(await file('scripts/demo/seed-field-links.sql'));
    const sessions = (await db.query('select * from sessions')).rows;
    assert.equal(sessions.length, 48, 'eight fields, two neighbours each, three meetings per pair');
    assert.ok(sessions.every(s => s.title.startsWith('[Demo] ') && s.status === 'completed' && s.created_at < new Date(Date.now() - 13 * 864e5)));
    assert.ok(sessions.every(s => s.mentor_id !== id(999) && s.mentee_id !== id(999)), 'the real account is left alone');
    assert.ok(sessions.every(s => s.mentor_id !== id(0)), 'a refused mentor is skipped, and the pair is still filled');
    assert.equal((await links()).length, 16, 'every seeded pair of fields is now linked');
    assert.ok((await links()).every(e => e.count >= 5));

    await db.exec(await file('scripts/demo/seed-field-links.sql'));
    assert.equal((await one('select count(*)::int n from sessions')).n, 48, 'a second run adds nothing');

    await db.exec("insert into sessions(mentor_id, mentee_id, title, status) values ('" + id(0) + "', '" + id(999) + "', 'A real meeting', 'completed')");
    await db.exec(await file('scripts/demo/remove-field-links.sql'));
    assert.deepEqual((await db.query('select title from sessions')).rows.map(r => r.title), ['A real meeting']);
  } finally {
    await db.close();
  }
});
