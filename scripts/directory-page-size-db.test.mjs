import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const viewer = '10000000-0000-0000-0000-000000000001';
const org = '30000000-0000-0000-0000-000000000001';

test('the directory serves pages of up to 100 and reports the limit it applied', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table organizations(id uuid primary key, type text default 'intra');
      create table profiles(id uuid primary key, name text, organization_id uuid, admin_scope text default 'none',
        onboarding_complete boolean default true, deactivated_at timestamptz, job_title text, department text,
        program text, bio text, role text default 'student', cohort_year integer, location text, working_language text);
      create table skills(user_id uuid, skill text, type text);
      create function is_currently_available_mentor(uuid) returns boolean language sql stable as $$ select true $$;
      create function redacted_name(text) returns text language sql immutable as $$ select 'Member' $$;
      insert into organizations(id) values ('${org}');
      insert into profiles(id, name, organization_id) values ('${viewer}', 'Viewer', '${org}');
      insert into profiles(id, name, organization_id, location)
        select ('40000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Person ' || lpad(n::text, 3, '0'), '${org}',
          case when n <= 30 then 'Paris' else 'London' end
        from generate_series(1, 230) n;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261010100000_0084_directory_page_size_100.sql', import.meta.url), 'utf8'));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
    const browse = async (limit, offset = 0, location = null) => (await db.query(
      "select public.directory_browse(p_limit => $1, p_offset => $2, p_location => $3, p_sort => 'name') result", [limit, offset, location],
    )).rows[0].result;

    for (const [asked, served] of [[25, 25], [50, 50], [100, 100], [500, 100], [0, 1], [null, 12]]) {
      const page = await browse(asked);
      assert.equal(page.people.length, served, `asked for ${asked}`);
      assert.equal(page.limit, served);
      assert.equal(page.total, 230);
    }
    // Offsets follow the page size: page 3 of 100 holds the last 30 people.
    const last = await browse(100, 200);
    assert.equal(last.people.length, 30);
    assert.equal(last.people.at(-1).name, 'Person 230');
    assert.equal((await browse(100, 100)).people[0].name, 'Person 101');
    // Past the end is empty, not an error.
    assert.equal((await browse(100, 300)).people.length, 0);
    // Filters still apply at every size.
    const paris = await browse(100, 0, 'Paris');
    assert.equal(paris.total, 30);
    assert.equal(paris.people.length, 30);
  } finally {
    await db.close();
  }
});
