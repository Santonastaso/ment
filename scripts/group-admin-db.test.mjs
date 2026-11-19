import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = readFile(new URL('../supabase/migrations/20261119002519_group_co_admins.sql', import.meta.url), 'utf8');
const owner = '10000000-0000-0000-0000-000000000001';
const admin = '10000000-0000-0000-0000-000000000002';
const member = '10000000-0000-0000-0000-000000000003';
const candidate = '10000000-0000-0000-0000-000000000004';
const org = '20000000-0000-0000-0000-000000000001';

test('group owners can appoint co-admins without giving away ownership', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key);
      create table profiles(id uuid primary key, organization_id uuid, name text, admin_scope text default 'none',
        deactivated_at timestamptz, onboarding_complete boolean default true);
      create table groups(id bigint primary key, organization_id uuid, name text, description text default '',
        created_by uuid, created_at timestamptz default now(), route_token text default 'group-route');
      create table group_members(group_id bigint, user_id uuid, role text default 'member'
        check (role in ('owner','member')), created_at timestamptz default now(), primary key(group_id, user_id));
      create table group_join_requests(group_id bigint, user_id uuid, reason text, status text default 'pending',
        created_at timestamptz default now(), expires_at timestamptz default now() + interval '7 days', primary key(group_id, user_id));
      create table group_messages(id bigint generated always as identity primary key, group_id bigint, body text, created_at timestamptz default now());
      alter table group_join_requests enable row level security;
      create policy group_join_requests_read on group_join_requests for select to authenticated using (user_id = auth.uid());
      insert into auth.users values ('${owner}'), ('${admin}'), ('${member}'), ('${candidate}');
      insert into profiles(id, organization_id, name) values
        ('${owner}', '${org}', 'Owner'), ('${admin}', '${org}', 'Admin'),
        ('${member}', '${org}', 'Member'), ('${candidate}', '${org}', 'Candidate');
      insert into groups(id, organization_id, name, created_by) values (1, '${org}', 'Test group', '${owner}');
      insert into group_members(group_id, user_id, role) values (1, '${owner}', 'owner'), (1, '${admin}', 'member'), (1, '${member}', 'member');
    `);
    await db.exec(await migration);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.query('select manage_group_admin(1, $1, true)', [admin]);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    const directory = (await db.query('select group_member_directory(1, null) value')).rows[0].value;
    assert.equal(directory.can_manage_admins, false);
    assert.equal(directory.members.find(person => person.id === admin).is_admin, true);
    await db.query('select manage_group_member(1, $1, true)', [candidate]);
    await assert.rejects(db.query('select manage_group_admin(1, $1, true)', [member]), /owner_required/);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.query('select manage_group_admin(1, $1, false)', [admin]);
    assert.equal((await db.query('select role from group_members where group_id = 1 and user_id = $1', [admin])).rows[0].role, 'member');

    await db.query('select manage_group_admin(1, $1, true)', [admin]);
    await db.query('update profiles set deactivated_at = now() where id = $1', [admin]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    await assert.rejects(db.query('select manage_group_member(1, $1, false)', [member]), /not_allowed/);
  } finally {
    await db.close();
  }
});
