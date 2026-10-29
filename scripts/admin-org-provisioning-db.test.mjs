import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = new URL('../supabase/migrations/20261029100000_0095_platform_provision_org_admin.sql', import.meta.url);
const platformId = '10000000-0000-0000-0000-000000000001';
const schoolAdminId = '10000000-0000-0000-0000-000000000002';
const secondAdminId = '10000000-0000-0000-0000-000000000003';
const orgAdminId = '10000000-0000-0000-0000-000000000004';
const orgId = '20000000-0000-0000-0000-000000000001';

test('only a platform admin can grant a new audited school-admin profile', async () => {
  const db = new PGlite();
  const call = (actorId, userId, organizationId = orgId, name = 'School Admin') =>
    db.query('select public.platform_provision_org_admin($1, $2, $3, $4)', [actorId, userId, organizationId, name]);
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role;
      create function auth.role() returns text language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      create table auth.users (id uuid primary key);
      create table public.organizations (id uuid primary key);
      create table public.profiles (
        id uuid primary key references auth.users(id),
        name text not null, organization_id uuid not null references public.organizations(id),
        admin_scope text not null default 'none', is_admin boolean not null default false,
        role text not null default 'student', onboarding_complete boolean not null default false,
        must_change_password boolean not null default false, deactivated_at timestamptz
      );
      create table public.audit_logs (
        actor_id uuid references auth.users(id), action text not null,
        target_type text not null, target_id text, metadata jsonb not null
      );
      insert into auth.users values ('${platformId}'), ('${schoolAdminId}'), ('${secondAdminId}'), ('${orgAdminId}');
      insert into public.organizations values ('${orgId}');
      insert into public.profiles (id, name, organization_id, admin_scope, is_admin)
        values ('${platformId}', 'Platform', '${orgId}', 'platform', true),
               ('${orgAdminId}', 'School', '${orgId}', 'org', true);
    `);
    await db.exec(await readFile(migration, 'utf8'));

    assert.equal((await db.query("select has_function_privilege('authenticated', 'public.platform_provision_org_admin(uuid,uuid,uuid,text)', 'EXECUTE') as allowed")).rows[0].allowed, false);
    await assert.rejects(call(platformId, schoolAdminId), /service_role_required/);
    await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
    await assert.rejects(call(orgAdminId, schoolAdminId), /platform_admin_required/);
    await assert.rejects(call(platformId, schoolAdminId, '20000000-0000-0000-0000-000000000099'), /organization_missing/);
    assert.equal((await db.query('select count(*)::int as count from public.profiles where id = $1', [schoolAdminId])).rows[0].count, 0);

    await call(platformId, schoolAdminId);
    assert.deepEqual((await db.query('select admin_scope, is_admin, organization_id, onboarding_complete, must_change_password from public.profiles where id = $1', [schoolAdminId])).rows[0], {
      admin_scope: 'org', is_admin: true, organization_id: orgId,
      onboarding_complete: true, must_change_password: true,
    });
    assert.equal((await db.query("select count(*)::int as count from public.audit_logs where action = 'admin.org_admin_provisioned' and target_id = $1", [schoolAdminId])).rows[0].count, 1);
    await assert.rejects(call(platformId, schoolAdminId), /profile_already_exists/);

    await db.exec('alter table public.audit_logs add constraint reject_new_audit check (false) not valid');
    await assert.rejects(call(platformId, secondAdminId), /reject_new_audit/);
    assert.equal((await db.query('select count(*)::int as count from public.profiles where id = $1', [secondAdminId])).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
