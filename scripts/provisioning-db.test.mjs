import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const org = '20000000-0000-0000-0000-000000000001';
const existingAuthId = '10000000-0000-0000-0000-000000000001';
const orphanAuthId = '10000000-0000-0000-0000-000000000002';
const missingProfileId = '10000000-0000-0000-0000-000000000003';
const rollbackId = '10000000-0000-0000-0000-000000000004';
const otherOrg = '20000000-0000-0000-0000-000000000099';

test('admin provisioning atomically attaches Auth-only users and keeps tenant scope', async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    `);
    await db.exec(await read('migrations/0001_init.sql'));
    await db.exec(`
      create table public.organizations(id uuid primary key, name text not null);
      alter table public.profiles add column organization_id uuid references public.organizations(id),
        add column admin_scope text not null default 'none', add column program text not null default '',
        add column cohort_year integer, add column role text not null default 'student',
        add column linkedin_url text not null default '', add column linkedin_headline text not null default '',
        add column external_source text, add column external_id text, add column source_synced_at timestamptz;
      create function public.mark_matches_stale(uuid) returns void language plpgsql as $$ begin return; end $$;
      insert into public.organizations values ('${org}', 'Test org');
      insert into public.organizations values ('${otherOrg}', 'Other org');
      insert into auth.users values ('${existingAuthId}', 'existing@example.test'), ('${orphanAuthId}', 'orphan@example.test'), ('${missingProfileId}', 'missing@example.test'), ('${rollbackId}', 'rollback@example.test');
      insert into public.profiles(id, name, organization_id, admin_scope) values ('${existingAuthId}', 'Existing', '${org}', 'none');
      select set_config('request.jwt.claim.role', 'service_role', false);
    `);

    const migration = await read('migrations/20261002100000_0063_admin_member_provisioning.sql');
    await db.exec(migration.slice(migration.indexOf('create or replace function public.admin_auth_user_id_by_email'), migration.indexOf('-- Never let onboarding')));

    assert.equal((await one("select public.admin_auth_user_id_by_email(' ORPHAN@example.test ') as id")).id, orphanAuthId);
    const found = await one("select json_agg(row_to_json(matches)) as matches from public.admin_auth_users_by_email(array['ORPHAN@example.test', 'unknown@example.test']) matches");
    assert.deepEqual(found.matches, [{ email: 'orphan@example.test', user_id: orphanAuthId }]);
    await db.query('select public.admin_provision_member($1, $2, $3::jsonb, $4::jsonb, true, false)', [
      orphanAuthId, org,
      JSON.stringify({ name: 'Attached Member', role: 'student', onboarding_complete: false }),
      JSON.stringify({ can_teach: ['Coaching'], wants_to_learn: ['Leadership'] }),
    ]);
    assert.deepEqual(await one('select name, organization_id, onboarding_complete from profiles where id = $1', [orphanAuthId]), {
      name: 'Attached Member', organization_id: org, onboarding_complete: false,
    });
    assert.equal((await one('select count(*)::int as count from skills where user_id = $1', [orphanAuthId])).count, 2);
    await assert.rejects(db.query('select public.admin_provision_member($1, $2, $3::jsonb, $4::jsonb, true, false)', [
      rollbackId, org, JSON.stringify({ name: 'Must roll back', role: 'student' }), JSON.stringify({ can_teach: { invalid: true } }),
    ]), /cannot extract elements from an object/);
    assert.equal((await one('select count(*)::int as count from profiles where id = $1', [rollbackId])).count, 0);

    await assert.rejects(db.query('select public.admin_provision_member($1, $2, $3::jsonb)', [
      orphanAuthId, org, JSON.stringify({ name: 'Duplicate', role: 'student' }),
    ]), /member_profile_exists/);
    await assert.rejects(db.query('select public.admin_provision_member($1, $2, $3::jsonb, $4::jsonb, true, true)', [
      orphanAuthId, otherOrg, JSON.stringify({ name: 'Cross tenant', role: 'student' }), '{}',
    ]), /member_scope_mismatch/);
    assert.equal((await one('select name from profiles where id = $1', [orphanAuthId])).name, 'Attached Member');
    assert.equal((await one("select has_function_privilege('authenticated', 'admin_auth_users_by_email(text[])', 'EXECUTE') as allowed")).allowed, false);

    await db.exec(`
      alter table public.profiles add column matches_stale boolean not null default false;
      create function public._recompute_matches_for(uuid) returns void language sql as $$ select $$;
      update public.profiles set matches_stale = true;
    `);
    await db.exec(await read('migrations/20261004103000_0069_targeted_match_refresh.sql'));
    const refreshed = await one('select public.process_stale_matches_for($1::uuid[]) as result', [[orphanAuthId]]);
    assert.deepEqual(refreshed.result.processed, [orphanAuthId]);
    assert.equal((await one('select matches_stale from profiles where id = $1', [orphanAuthId])).matches_stale, false);
    assert.equal((await one('select matches_stale from profiles where id = $1', [existingAuthId])).matches_stale, true);

    await db.exec(migration.slice(migration.indexOf('-- Never let onboarding')));
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [missingProfileId]);
    await assert.rejects(db.query(`select public.save_onboarding(
      p_name => 'Missing profile', p_department => null, p_seniority => null,
      p_job_title => null, p_bio => null, p_shadow_role_response => null,
      p_tenure_years => null, p_location => null, p_career => '[]'::jsonb,
      p_can_teach => '[]'::jsonb, p_wants_to_learn => '[]'::jsonb
    )`), /profile_missing/);
    assert.equal((await one('select count(*)::int as count from skills where user_id = $1', [missingProfileId])).count, 0);
  } finally {
    await db.close();
  }
});
