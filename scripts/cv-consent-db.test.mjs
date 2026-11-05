import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const me = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';

test('CV withdrawal stops future processing while preserving another member and the acceptance history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table profiles(id uuid primary key);
      insert into profiles values ('${me}'), ('${other}');
      create table consent_records(id bigserial primary key, user_id uuid, purpose text, accepted_at timestamptz default now());
      create table profile_drafts(id bigserial primary key, user_id uuid, source text, raw_text text);
      grant select on consent_records, profile_drafts to authenticated;
      grant insert, update on profile_drafts to authenticated;
      grant usage on sequence profile_drafts_id_seq to authenticated;
      insert into consent_records(user_id, purpose) values
        ('${me}', 'ai_profile_import'), ('${me}', 'terms_privacy'), ('${other}', 'ai_profile_import');
      insert into profile_drafts(user_id, source, raw_text) values
        ('${me}', 'cv', 'private CV'), ('${me}', 'other', 'other source'), ('${other}', 'cv', 'their CV');
    `);
    const migration = await readFile(new URL('../supabase/migrations/20261105110000_0100_withdrawable_cv_consent.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    const draftGuard = await readFile(new URL('../supabase/migrations/20261105140000_0103_atomic_cv_draft_consent.sql', import.meta.url), 'utf8');
    await db.exec(draftGuard);
    const own = async (sql) => (await db.query(sql)).rows;
    assert.equal((await own("select has_function_privilege('anon', 'public.withdraw_cv_import_consent()', 'execute') value"))[0].value, false);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [me]);
    await db.exec('set role authenticated');
    await db.query(`insert into profile_drafts(user_id, source, raw_text) values ('${me}', 'cv', 'new permitted CV')`);
    assert.equal((await own('select withdraw_cv_import_consent() value'))[0].value, 1);
    const records = await own('select user_id, purpose, withdrawn_at is not null as withdrawn from consent_records order by id');
    assert.deepEqual(records.map(r => r.withdrawn), [true, false, false]);
    assert.deepEqual((await own('select user_id, source from profile_drafts order by id')).map(r => r.source), ['other', 'cv']);
    await assert.rejects(db.query(`insert into profile_drafts(user_id, source, raw_text) values ('${me}', 'cv', 'late CV')`), /cv_consent_required/);
    await db.query(`insert into profile_drafts(user_id, source, raw_text) values ('${other}', 'cv', 'still permitted')`);
    await assert.rejects(db.query(`update profile_drafts set source = 'cv' where user_id = '${me}' and source = 'other'`), /cv_consent_required/);
    assert.equal((await own('select withdraw_cv_import_consent() value'))[0].value, 0);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await assert.rejects(db.query('select withdraw_cv_import_consent()'), /auth_required/);
  } finally {
    await db.close();
  }
});
