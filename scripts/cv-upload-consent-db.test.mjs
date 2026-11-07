import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const me = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';

test('upload metadata writes require active consent even with service privileges; deletes remain possible', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table consent_records(id bigserial primary key, user_id uuid, purpose text, accepted_at timestamptz default now());
      create table profile_drafts(id bigserial primary key, user_id uuid, source text);
      create schema storage;
      create table storage.objects(id bigserial primary key, bucket_id text, name text, metadata jsonb);
      insert into consent_records(user_id, purpose) values ('${me}', 'ai_profile_import'), ('${other}', 'ai_profile_import');
    `);
    for (const file of ['20261105110000_0100_withdrawable_cv_consent.sql', '20261105140000_0103_atomic_cv_draft_consent.sql', '20261106110000_0105_cv_upload_consent_guard.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [me]);
    await db.exec(`insert into storage.objects(bucket_id, name) values ('profile-uploads', '${me}/cv.pdf')`);
    await db.exec(`insert into profile_drafts(user_id, source) values ('${me}', 'cv')`);
    await db.exec('select withdraw_cv_import_consent()');
    const upload = name => db.query(`insert into storage.objects(bucket_id, name) values ('profile-uploads', $1)`, [name]);
    await assert.rejects(upload(`${me}/late.pdf`), /cv_consent_required/);
    await assert.rejects(db.exec(`update storage.objects set metadata = '{}' where name = '${me}/cv.pdf'`), /cv_consent_required/);
    await assert.rejects(upload('invalid-prefix/cv.pdf'), /cv_consent_required/);
    await assert.rejects(db.exec(`insert into profile_drafts(user_id, source) values ('${me}', 'cv')`), /cv_consent_required/);
    await upload(`${other}/keep.pdf`);
    await db.exec(`insert into storage.objects(bucket_id, name) values ('imports', 'admin.csv')`);
    await db.exec(`delete from storage.objects where name = '${me}/cv.pdf'`);
    await db.exec(`insert into consent_records(user_id, purpose) values ('${me}', 'ai_profile_import')`);
    await upload(`${me}/new-permission.pdf`);
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n, 3);
  } finally { await db.close(); }
});
