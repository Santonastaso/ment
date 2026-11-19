import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = readFile(new URL('../supabase/migrations/20261119002531_directory_access_throttling.sql', import.meta.url), 'utf8');
const viewer = '10000000-0000-0000-0000-000000000001';
const inactiveViewer = '10000000-0000-0000-0000-000000000002';

test('directory browsing is private and throttles automated extraction', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${viewer}'), ('${inactiveViewer}');
      create function public.directory_browse(
        p_limit integer default 12, p_offset integer default 0, p_persona text default null,
        p_program text default null, p_cohort_year integer default null, p_location text default null,
        p_working_language text default null, p_query text default null, p_sort text default 'relevance'
      ) returns jsonb language sql stable security definer as
        $$ select jsonb_build_object('people', '[]'::jsonb, 'limit', least(p_limit, 100)) $$;
      grant execute on function public.directory_browse(integer, integer, text, text, integer, text, text, text, text) to authenticated;
    `);
    await db.exec(await migration);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
    for (let i = 0; i < 30; i += 1) {
      const result = (await db.query('select directory_browse() value')).rows[0].value;
      assert.equal(result.limit, 12);
    }
    await assert.rejects(db.query('select directory_browse()'), /rate_limited/);
    assert.equal((await db.query('select count(*)::int count from directory_access_events')).rows[0].count, 30);
    await db.query(`insert into directory_access_events(user_id, requested_at)
      values ($1, now() - interval '49 hours')`, [inactiveViewer]);
    assert.equal((await db.query('select purge_directory_access_events() value')).rows[0].value, 1);
    const grants = await db.query(`select grantee from information_schema.role_table_grants
      where table_name = 'directory_access_events' and grantee in ('anon', 'authenticated')`);
    assert.equal(grants.rows.length, 0);
  } finally {
    await db.close();
  }
});
