import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const serviceToken = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`;
const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function handlerFixture() {
  const source = await readFile(new URL('../supabase/functions/retention-sweep/index.ts', import.meta.url), 'utf8');
  const withoutImports = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '');
  let handler;
  let adminCalls = 0;
  let destructiveCalls = 0;
  const sandbox = {
    Deno: { serve(fn) { handler = fn; } }, Request, Response, Date, Set, atob,
    corsHeaders: {},
    jsonOk: json,
    jsonError: (message, status) => json({ error: message }, status),
    adminClient: () => {
      adminCalls++;
      return { rpc: async name => {
        assert.equal(name, 'report_data_retention');
        return { data: { messages: 2 }, error: null };
      }, storage: {} };
    },
    inspectStaleProfileUploads: async () => ({ eligible: 3, undated: 1 }),
    removeStaleProfileUploads: async () => { destructiveCalls++; throw new Error('must not run'); },
    removeUserProfileUploads: async () => { destructiveCalls++; throw new Error('must not run'); },
    closeErasedLogin: async () => { destructiveCalls++; throw new Error('must not run'); },
    generateTempPassword: () => 'unused',
    console: { log() {}, error() {} },
  };
  runInNewContext(stripTypeScriptTypes(withoutImports), sandbox);
  return { handler, calls: () => ({ adminCalls, destructiveCalls }) };
}

test('retention endpoint rejects an absent or unknown mode before opening the admin client', async () => {
  const fixture = await handlerFixture();
  for (const mode of [undefined, 'preview', 'APPLY']) {
    const headers = { Authorization: `Bearer ${serviceToken}` };
    if (mode) headers['x-retention-mode'] = mode;
    const response = await fixture.handler(new Request('https://local.invalid', { method: 'POST', headers }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'retention_mode_required' });
  }
  assert.deepEqual(fixture.calls(), { adminCalls: 0, destructiveCalls: 0 });
});

test('retention report returns counts without invoking deletion helpers', async () => {
  const fixture = await handlerFixture();
  const response = await fixture.handler(new Request('https://local.invalid', { method: 'POST', headers: {
    Authorization: `Bearer ${serviceToken}`, 'x-retention-mode': 'report',
  } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: 'report', messages: 2, stale_uploads_eligible: 3, stale_uploads_undated: 1,
  });
  assert.deepEqual(fixture.calls(), { adminCalls: 1, destructiveCalls: 0 });
});
