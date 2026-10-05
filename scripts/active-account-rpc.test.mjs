import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = readFile(new URL('../supabase/migrations/20261005100000_0071_active_account_rpc_guards.sql', import.meta.url), 'utf8');
const active = '10000000-0000-0000-0000-000000000001';
const inactive = '10000000-0000-0000-0000-000000000002';

test('SECURITY DEFINER onboarding and group history RPCs reject deactivated callers', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.profiles(id uuid primary key, name text, deactivated_at timestamptz);
      create table public.group_members(group_id bigint, user_id uuid);
      create table public.group_messages(id bigint, group_id bigint, sender_id uuid, body text, created_at timestamptz);
      insert into profiles values ('${active}', 'Active', null), ('${inactive}', 'Inactive', now());
      insert into group_members values (1, '${active}'), (1, '${inactive}');
      create function public.is_active_user() returns boolean language sql stable security definer
        set search_path = public as $$
          select auth.uid() is not null and exists(select 1 from profiles where id = auth.uid() and deactivated_at is null)
        $$;
      create function public.save_onboarding(
        p_name text, p_department text, p_seniority text, p_job_title text,
        p_bio text, p_shadow_role_response text, p_tenure_years integer,
        p_location text, p_career jsonb, p_can_teach jsonb, p_wants_to_learn jsonb,
        p_program text default null, p_cohort_year integer default null, p_persona text default null
      ) returns void language plpgsql security definer set search_path = public as $$
      begin
        if auth.uid() is null then raise exception 'auth_required'; end if;
        update profiles set name = p_name where id = auth.uid();
      end; $$;
      create function public.my_group_messages(p_group_id bigint, p_limit integer default 50, p_before bigint default null)
      returns jsonb language plpgsql stable security definer set search_path = public as $$
      begin
        if not exists(select 1 from group_members where group_id = p_group_id and user_id = auth.uid()) then
          raise exception 'not_a_member';
        end if;
        return '[]'::jsonb;
      end; $$;
    `);
    await db.exec(await migration);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [active]);
    await db.query(`select public.save_onboarding('Updated', null, null, null, null, null, null, null, null, null, null)`);
    assert.equal((await db.query('select name from profiles where id = $1', [active])).rows[0].name, 'Updated');
    assert.deepEqual((await db.query('select public.my_group_messages(1) as messages')).rows[0].messages, []);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [inactive]);
    await assert.rejects(db.query(`select public.save_onboarding('Changed', null, null, null, null, null, null, null, null, null, null)`), /account_deactivated/);
    await assert.rejects(db.query('select public.my_group_messages(1) as messages'), /account_deactivated/);
    assert.equal((await db.query('select name from profiles where id = $1', [inactive])).rows[0].name, 'Inactive');

    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(db.query(`select public.save_onboarding('Unauthenticated', null, null, null, null, null, null, null, null, null, null)`), /auth_required/);
    await assert.rejects(db.query('select public.my_group_messages(1) as messages'), /not_a_member/);
  } finally {
    await db.close();
  }
});
