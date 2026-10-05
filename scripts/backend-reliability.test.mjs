import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const userId = '10000000-0000-0000-0000-000000000001';

test('calendar work is queued at commit and claimed once', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create function auth.role() returns text language sql as
        $$ select current_setting('request.jwt.claim.role', true) $$;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${userId}');
      create table public.sessions(id bigint primary key, status text, scheduled_at timestamptz);
      create table public.calendar_events(session_id bigint, scheduled_for timestamptz);
      insert into public.sessions values (1, 'scheduled', '2026-10-10T10:00:00Z');
      insert into public.calendar_events values (1, '2026-10-10T10:00:00Z');
      select set_config('request.jwt.claim.role', 'service_role', false);
    `);
    await db.exec(await migration('20261004101000_0067_calendar_reconciliation.sql'));
    await db.exec("update public.sessions set scheduled_at = '2026-10-10T11:00:00Z' where id = 1");
    const first = await db.query('select * from public.claim_calendar_sync_jobs(20)');
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].attempts, 1);
    assert.equal((await db.query('select * from public.claim_calendar_sync_jobs(20)')).rows.length, 0);
    await db.exec("update public.sessions set status = 'cancelled' where id = 1");
    const next = await db.query('select * from public.claim_calendar_sync_jobs(20)');
    assert.equal(next.rows.length, 1);
    assert.ok(next.rows[0].generation > first.rows[0].generation);
    assert.equal(next.rows[0].attempts, 1);
    const claim = await db.query('select public.claim_calendar_event(1, $1, $2::uuid) as token', ['google', userId]);
    assert.ok(claim.rows[0].token);
    const duplicate = await db.query('select public.claim_calendar_event(1, $1, $2::uuid) as token', ['google', userId]);
    assert.equal(duplicate.rows[0].token, null);
    await db.exec(`
      insert into public.sessions values (2, 'cancelled', null);
      insert into public.calendar_events values (2, '2026-10-10T10:00:00Z');
    `);
    assert.equal((await db.query('select status from public.calendar_sync_jobs where session_id = 2')).rows[0].status, 'queued');
  } finally {
    await db.close();
  }
});

test('profile source text expires after 30 days, including historical drafts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema cron;
      create table cron.job(jobid bigint generated always as identity, jobname text);
      create function cron.unschedule(bigint) returns boolean language sql as $$ select true $$;
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$
      begin insert into cron.job(jobname) values ($1); return 1; end $$;
      create table public.profile_drafts(
        id bigint primary key, raw_text text, proposed_json jsonb,
        created_at timestamptz not null default now()
      );
      insert into public.profile_drafts values
        (1, 'old source', '{}'::jsonb, now() - interval '60 days');
    `);
    await db.exec(await migration('20261004104000_0070_profile_source_retention.sql'));
    await db.exec(await migration('20261005101000_0072_profile_source_retention_backfill.sql'));
    assert.equal((await db.query("select count(*)::int as count from cron.job where jobname = 'mt-profile-source-retention'")).rows[0].count, 1);
    await db.exec("insert into public.profile_drafts(id, raw_text, proposed_json) values (2, 'new source', '{}'::jsonb)");
    await db.exec("insert into public.profile_drafts(id, raw_text, proposed_json) values (3, null, '{}'::jsonb)");
    await db.exec("update public.profile_drafts set raw_text = 'newly added source' where id = 3");
    assert.ok((await db.query('select raw_text_expires_at from profile_drafts where id = 1')).rows[0].raw_text_expires_at < new Date());
    await db.exec("update public.profile_drafts set raw_text_expires_at = now() - interval '1 day' where id = 2");
    assert.ok((await db.query('select raw_text_expires_at from profile_drafts where id = 2')).rows[0].raw_text_expires_at > new Date());
    assert.ok((await db.query('select raw_text_expires_at from profile_drafts where id = 3')).rows[0].raw_text_expires_at > new Date());
    await db.exec('drop trigger profile_source_expiry on public.profile_drafts');
    await db.exec("update public.profile_drafts set raw_text_expires_at = now() - interval '1 day' where id = 2");
    assert.equal((await db.query('select public.purge_expired_profile_source_text() as purged')).rows[0].purged, 2);
    const rows = (await db.query('select id, raw_text, proposed_json from public.profile_drafts order by id')).rows;
    assert.equal(rows[0].raw_text, null);
    assert.equal(rows[1].raw_text, null);
    assert.deepEqual(rows[1].proposed_json, {});
  } finally {
    await db.close();
  }
});
