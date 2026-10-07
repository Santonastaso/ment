import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '10000000-0000-0000-0000-000000000001';
const member = '10000000-0000-0000-0000-000000000002';
const outsider = '10000000-0000-0000-0000-000000000003';
const otherOrg = '20000000-0000-0000-0000-000000000001';

test('only the active group owner can manage same-organization members', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key, name text, organization_id uuid,
        admin_scope text default 'none', deactivated_at timestamptz, onboarding_complete boolean default true);
      create table groups(id bigint primary key, organization_id uuid, created_by uuid);
      create table group_members(group_id bigint, user_id uuid, role text default 'member', primary key(group_id, user_id));
      create table group_join_requests(group_id bigint, user_id uuid, status text, primary key(group_id, user_id));
      grant select on group_join_requests to authenticated;
      insert into profiles(id, name, organization_id) values
        ('${owner}', 'Owner', '30000000-0000-0000-0000-000000000001'),
        ('${member}', 'Member', '30000000-0000-0000-0000-000000000001'),
        ('${outsider}', 'Other group', '${otherOrg}');
      insert into groups values(1, '30000000-0000-0000-0000-000000000001', '${owner}');
      insert into group_members values(1, '${owner}', 'owner');
      insert into group_join_requests values(1, '${member}', 'pending');
    `);
    const managementSql = await readFile(new URL('../supabase/migrations/20261007105000_0082_group_member_management.sql', import.meta.url), 'utf8');
    const ownerSql = await readFile(new URL('../supabase/migrations/20261007111500_0083_normalize_group_owners.sql', import.meta.url), 'utf8');
    await db.exec(managementSql);
    await db.exec("update group_members set role = 'member' where user_id = '10000000-0000-0000-0000-000000000001'");
    await db.exec(ownerSql);
    assert.equal((await db.query("select role from group_members where user_id = '10000000-0000-0000-0000-000000000001'")).rows[0].role, 'owner');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec('set role authenticated');

    const directory = (await db.query("select group_member_directory(1, 'mem') as value")).rows[0].value;
    assert.deepEqual(directory.candidates.map(person => person.name), ['Member']);
    await assert.rejects(db.query(`select manage_group_member(1, '${outsider}', true)`), /member_unavailable/);
    await db.query(`select manage_group_member(1, '${member}', true)`);
    assert.equal((await db.query(`select status from group_join_requests where user_id = '${member}'`)).rows[0].status, 'accepted');
    assert.equal((await db.query('select group_member_directory(1) as value')).rows[0].value.members.length, 2);
    await assert.rejects(db.query(`select manage_group_member(1, '${owner}', false)`), /group_owner_cannot_leave/);
    await db.query(`select manage_group_member(1, '${member}', false)`);
    assert.equal((await db.query(`select status from group_join_requests where user_id = '${member}'`)).rows[0].status, 'withdrawn');

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [member]);
    await assert.rejects(db.query('select group_member_directory(1)'), /not_allowed/);
    await assert.rejects(db.query(`select manage_group_member(1, '${member}', true)`), /not_allowed/);
  } finally {
    await db.close();
  }
});
