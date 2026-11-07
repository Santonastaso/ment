import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { client, configuration, fixture, fixtureEmail, ownsUser, ownsOrg, runAcceptance, verifyErasedSession,
  acceptanceArtifact, acceptanceSummary, DOMAIN, CONFIRMATION } from './privacy-acceptance.mjs';
import { PGlite } from '@electric-sql/pglite';

const config = { url: 'https://fixture.supabase.co', anon: 'synthetic-anon', service: 'synthetic-service' };
const validEnv = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  PRIVACY_ENVIRONMENT: 'production', PRIVACY_SYNTHETIC_CONFIRMATION: CONFIRMATION,
  SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.anon, SUPABASE_SERVICE_ROLE_KEY: config.service };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('preflight requires explicit confirmation, main, manual dispatch, production and exact configured host', () => {
  const toml = 'project_id = "fixture"';
  assert.deepEqual(configuration(validEnv, toml), config);
  for (const [key, values] of Object.entries({
    GITHUB_ACTIONS: ['', 'false'], GITHUB_EVENT_NAME: ['push', 'pull_request'], GITHUB_REF: ['refs/heads/fix/privacy-readiness-sprint', 'refs/tags/main'],
    PRIVACY_ENVIRONMENT: ['preview', ''], PRIVACY_SYNTHETIC_CONFIRMATION: ['true', ''],
    SUPABASE_URL: ['http://fixture.supabase.co', config.url + '/', config.url + '.evil', config.url + '/redirect'],
    SUPABASE_ANON_KEY: ['', config.service], SUPABASE_SERVICE_ROLE_KEY: [''],
  })) for (const value of values) assert.throws(() => configuration({ ...validEnv, [key]: value }, toml));
});

function ownedFixture() {
  const f = fixture();
  const u = { id: randomUUID(), role: 'member', email: fixtureEmail(f, 'member') };
  f.users.push(u);
  const user = { id: u.id, email: u.email, app_metadata: { organization_id: f.org.id,
    privacy_acceptance_org: f.org.id, privacy_acceptance_run: f.run } };
  const profiles = [{ id: u.id, organization_id: f.org.id, name: 'Synthetic member', erased_at: null }];
  return { f, u, user, profiles };
}

test('cleanup ownership rejects existing, cross-run, wrong-domain and reassigned accounts', () => {
  const { f, u, user, profiles } = ownedFixture();
  for (const role of ['member', 'peer', 'target', 'admin']) {
    assert.ok(fixtureEmail(f, role).split('@')[0].length <= 64);
    assert.equal(fixtureEmail(f, role).split('@')[1], DOMAIN);
  }
  assert.equal(ownsUser(f, u, user, profiles), true);
  for (const changed of [ { ...user, id: randomUUID() }, { ...user, email: 'real@example.com' },
    { ...user, app_metadata: {} }, { ...user, app_metadata: { ...user.app_metadata, privacy_acceptance_run: randomUUID() } },
    { ...user, app_metadata: { ...user.app_metadata, organization_id: randomUUID() } } ])
    assert.ok(!ownsUser(f, u, changed, profiles));
  assert.ok(!ownsUser(f, { ...u }, user, profiles));
  assert.ok(!ownsUser(f, u, user, [{ ...profiles[0], organization_id: randomUUID() }]));
  assert.ok(!ownsOrg(f, [{ ...f.org, slug: 'ment-demo' }]));
  assert.ok(ownsOrg(f, [f.org]));
});

test('erased address is accepted only for the tracked ID with an owned Former member tombstone', () => {
  const { f, u, user, profiles } = ownedFixture();
  user.email = `erased-${u.id}@erased.invalid`;
  assert.ok(!ownsUser(f, u, user, profiles));
  profiles[0].name = 'Former member'; profiles[0].erased_at = new Date().toISOString();
  assert.ok(ownsUser(f, u, user, profiles));
  assert.ok(!ownsUser(f, u, user, []));
  user.email = `erased-${randomUUID()}@erased.invalid`;
  assert.ok(!ownsUser(f, u, user, profiles));
});

test('HTTP errors and redirects cannot leak server data, credentials or arbitrary URLs', async () => {
  let calls = 0;
  const api = client(config, async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return json({ error: 'private@example.com SECRET credential' }, 500);
  });
  await assert.rejects(api('/rest/v1/profiles'), { message: 'request_failed' });
  for (const path of ['https://evil.test', '/rest/v1/../auth', '/functions/v1/https://evil.test',
    '/functions/v1/profile-ingest', '/functions/v1/discovery-assistant', '/functions/v1/send-notification-outbox'])
    await assert.rejects(api(path));
  assert.equal(calls, 1);
});

// A deliberately small fake service exercises partial setup, the finally path,
// ambiguous creation, and cleanup refusals without opening any network sockets.
function setupFailureService({ foreign = false, ambiguous = false, storageFails = false } = {}) {
  let org; let user; const requests = []; const deletes = [];
  const transport = async (url, options) => {
    const path = url.slice(config.url.length); const method = options.method;
    const body = options.body && JSON.parse(options.body);
    requests.push([method, path]);
    if (method === 'DELETE') deletes.push(path);
    if (path === '/rest/v1/organizations' && method === 'POST') { org = body; return json([body], 201); }
    if (path.startsWith('/rest/v1/organizations?')) {
      if (method === 'DELETE') { org = null; return json([]); }
      return json(org ? [org] : []);
    }
    if (path === '/auth/v1/admin/users' && method === 'POST') {
      user = body;
      if (ambiguous) throw new Error('private server body');
      return json(user, 201);
    }
    if (path.startsWith('/auth/v1/admin/users/')) {
      if (method === 'DELETE') { user = null; return json({}); }
      return user ? json(foreign ? { ...user, email: 'existing@example.com' } : user) : json({}, 404);
    }
    if (path.startsWith('/rest/v1/profiles?')) return json([]);
    // Fail setup at profile insertion after Auth creation.
    if (path === '/rest/v1/profiles') return json({ error: 'sensitive payload' }, 500);
    if (path === '/storage/v1/object/profile-uploads') return json({}, storageFails ? 500 : 200);
    if (path === '/storage/v1/object/list/profile-uploads') return json([]);
    if (path.startsWith('/rest/v1/sessions?') || path.startsWith('/rest/v1/audit_logs?')) return json([]);
    throw new Error('unexpected request');
  };
  return { transport, requests, deletes };
}

for (const ambiguous of [false, true]) test(`finally cleans only exact newly created fixtures after ${ambiguous ? 'ambiguous Auth creation' : 'setup failure'}`, async () => {
  const fake = setupFailureService({ ambiguous });
  const report = await runAcceptance(config, fake);
  assert.equal(report.failed, 1); assert.equal(report.cleanup_errors, 0);
  assert.ok(fake.deletes.some(p => p.startsWith('/auth/v1/admin/users/')));
  assert.ok(fake.deletes.some(p => p.startsWith('/rest/v1/organizations?id=eq.')));
  assert.ok(fake.deletes.every(p => p.includes('eq.') || /^\/auth\/v1\/admin\/users\/[a-f0-9-]+$/.test(p) || p === '/storage/v1/object/profile-uploads'));
  assert.ok(!JSON.stringify(report).includes('sensitive'));
});

test('cleanup refuses a mismatched email instead of deleting an existing account', async () => {
  const fake = setupFailureService({ foreign: true });
  const report = await runAcceptance(config, fake);
  assert.equal(report.failed, 1); assert.ok(report.cleanup_errors > 0);
  assert.ok(!fake.deletes.some(p => p.startsWith('/auth/') || p.startsWith('/storage/')));
});

test('failed storage cleanup preserves Auth identity for recovery and returns a safe error count', async () => {
  const fake = setupFailureService({ storageFails: true });
  const report = await runAcceptance(config, fake);
  assert.equal(report.cleanup_errors, 2); // Retain the org marker as well as Auth.
  assert.ok(!fake.deletes.some(p => p.startsWith('/auth/')));
  assert.ok(!fake.deletes.some(p => p.startsWith('/rest/v1/organizations')));
});

test('local real profile-ingest handler rejects opted-out fixtures before provider or storage calls', async () => {
  const source = await readFile(new URL('../supabase/functions/profile-ingest/index.ts', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../supabase/functions/_shared/auth.ts', import.meta.url), 'utf8');
  const helper = auth.slice(auth.indexOf('export async function aiOptedOut'), auth.indexOf('export async function requireAdmin'));
  let providerCalls = 0; let storageCalls = 0; let handler;
  for (const result of [{ data: { ai_opt_out: true }, error: null }, { data: null, error: {} }, { data: null, error: null }]) {
    const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
      storage: { from: () => { storageCalls++; throw new Error('storage forbidden'); } } };
    const aiOptedOut = runInNewContext(stripTypeScriptTypes(helper.replace('export ', '')) + '\naiOptedOut;');
    const sandbox = { Deno: { serve: fn => { handler = fn; } }, Response, Buffer, TextDecoder,
      corsHeaders: {}, requireUser: async () => ({ user: { id: 'synthetic' }, sb }), enforceRateLimit: async () => true,
      aiOptedOut, jsonError: (error, status) => json({ error }, status),
      mistralJson: async () => { providerCalls++; throw new Error('provider forbidden'); },
      fetch: () => { throw new Error('network forbidden'); } };
    const withoutImports = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '');
    runInNewContext(stripTypeScriptTypes(withoutImports), sandbox);
    const response = await handler(new Request('https://local.invalid', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'ai_opted_out' });
  }
  assert.equal(providerCalls, 0); assert.equal(storageCalls, 0);
});

test('manual workflow has main/environment gate, no automatic triggers, and serializes with release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/privacy-acceptance.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: release-supabase-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.ok(!/^\s+(push|pull_request|schedule):/m.test(workflow));
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /name: privacy-acceptance-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}-\$\{\{ github.sha \}\}/);
  assert.match(workflow, /if: always\(\)\s+env:[\s\S]*?--summarize/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /path: \.privacy-acceptance\/acceptance.json/);
});

test('acceptance evidence allowlists values and never copies payloads or credentials into JSON or summary', () => {
  const env = { GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'a'.repeat(40), PRIVACY_EXECUTION_OUTCOME: 'success',
    SUPABASE_SERVICE_ROLE_KEY: 'private-credential' };
  const report = acceptanceArtifact({ failed: 0, cleanup_errors: 0,
    passed: ['export_v2', 'cv_withdrawal', 'member_erasure', 'admin_erasure', 'no_notifications'],
    skipped: ['deployed_ai_provider_boundary'], body: 'private@example.com', credentials: env.SUPABASE_SERVICE_ROLE_KEY }, env);
  assert.equal(report.result, 'passed_with_skips');
  assert.equal(report.run_id, '1234'); assert.equal(report.commit, env.GITHUB_SHA);
  assert.equal(report.retention_days, 30); assert.equal(report.provisional, true);
  assert.ok(!JSON.stringify(report).includes('private'));
  assert.ok(!acceptanceSummary(report).includes('private'));
  const failed = acceptanceArtifact({ failed: 1, failed_stage: 'cv_withdrawal', cleanup_errors: 2 }, env);
  assert.equal(failed.result, 'failed'); assert.equal(failed.cleanup_errors, 2);
  assert.match(acceptanceSummary(failed), /Failed checks: 1; cleanup errors: 2/);
  for (const input of [undefined, {}, { failed: 'private', cleanup_errors: 0 },
    { failed: 1, cleanup_errors: 0, failed_stage: 'private@example.com' },
    { failed: 0, cleanup_errors: 0, passed: ['private-credential'] }]) {
    const missing = acceptanceArtifact(input, { ...env, GITHUB_RUN_ID: 'private@example.com', GITHUB_SHA: 'private-credential' });
    assert.equal(missing.result, 'unavailable'); assert.equal(missing.cleanup_errors, null);
    assert.equal(missing.run_id, 'unknown'); assert.equal(missing.commit, 'unknown');
    assert.ok(!acceptanceSummary(missing).includes('private'));
  }
  assert.equal(acceptanceArtifact({ failed: 0, cleanup_errors: 0 }, env).result, 'failed', 'empty success cannot pass');
});

test('erasure acceptance uses the real participant RPC under production column grants and separately checks raw removal', async () => {
  const db = new PGlite();
  const peer = { id: randomUUID(), token: 'synthetic-peer-jwt' };
  const session = { id: 1, mentor_id: peer.id, mentee_id: randomUUID() };
  const migration = async name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const definition = (sql, name) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0);
    return sql.slice(start, sql.indexOf('$$;', start) + 3);
  };
  const calls = [];
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table sessions (
        id bigint primary key, mentor_id uuid, mentee_id uuid, connection_id bigint,
        title text, scheduled_at timestamptz, duration_minutes int, status text,
        pre_session_question text default '', outbound_message text default '',
        reflection text default '', mentor_reflection text, mentee_rating int, mentor_rating int,
        mentee_completed_at timestamptz, mentor_completed_at timestamptz,
        mentee_acknowledged_at timestamptz, topics jsonb, created_at timestamptz,
        route_token text, meeting_url text, follow_up_intent text, accepted_at timestamptz,
        occurred_at timestamptz, last_activity_at timestamptz
      );
    `);
    await db.query(`insert into sessions(id,mentor_id,mentee_id,mentor_reflection,mentor_rating)
      values (1,$1,$2,'synthetic-peer-reflection',3)`, [peer.id, session.mentee_id]);
    const grants = await migration('0012_column_level_security.sql');
    await db.exec(grants.slice(grants.indexOf('revoke select on public.sessions'), grants.indexOf('revoke select on public.profiles')));
    await db.exec(definition(await migration('20261007100000_0077_clean_conversation_links.sql'), 'session_payload'));
    await db.exec(definition(await migration('0006_org_privacy_demo_fixes.sql'), 'my_session'));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [peer.id]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from sessions where id=1'), /permission denied/);
    await db.exec('reset role');
    const api = async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/rest/v1/rpc/my_session') {
        assert.equal(options.token, peer.token);
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.body, { p_session_id: 1 });
        await db.exec('set role authenticated');
        try { return { data: (await db.query('select my_session($1) value', [1])).rows[0].value }; }
        finally { await db.exec('reset role'); }
      }
      assert.equal(options.token, undefined, 'raw inspection uses the default service role');
      const params = new URL('https://local.invalid' + path).searchParams;
      assert.equal(params.get('id'), 'eq.1');
      assert.equal(params.get('mentor_id'), 'eq.' + peer.id);
      assert.equal(params.get('mentee_id'), 'eq.' + session.mentee_id);
      assert.equal(params.get('select'), 'id,reflection,mentee_rating,mentor_reflection,mentor_rating,outbound_message,pre_session_question');
      return { data: (await db.query('select ' + params.get('select') + ' from sessions where id=1')).rows };
    };
    await verifyErasedSession(api, session, peer);
    assert.equal(calls.length, 2);
    // The RPC masks the mentee note even if erasure regresses. The raw check
    // must catch that residual rather than treating redaction as deletion.
    await db.exec("update sessions set reflection='synthetic-residual-note' where id=1");
    await assert.rejects(verifyErasedSession(api, session, peer), /acceptance_failed/);
    await db.exec("update sessions set reflection='', mentor_reflection='' where id=1");
    await assert.rejects(verifyErasedSession(api, session, peer), /acceptance_failed/);
  } finally { await db.close(); }
});
