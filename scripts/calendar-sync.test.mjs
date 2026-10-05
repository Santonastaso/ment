import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(new URL('../client/package.json', import.meta.url))('esbuild');
const secret = 'local-test-calendar-secret-32-bytes';

async function handler() {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../supabase/functions/calendar-provider/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
    banner: { js: `const Deno = { serve: fn => { globalThis.__calendarHandler = fn; }, env: { get: key => key === 'CALENDAR_TOKEN_ENCRYPTION_KEY' ? '${secret}' : '' } };
      const fetch = (...args) => globalThis.__calendarFixture.fetch(...args);` },
    plugins: [{ name: 'calendar-auth-fixture', setup(builder) {
      builder.onResolve({ filter: /_shared\/index\.ts$/ }, () => ({ path: 'auth', namespace: 'calendar-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'calendar-fixture' }, () => ({
        contents: `export const corsHeaders = {};
          export const jsonOk = (value, status = 200) => Response.json(value, { status });
          export const jsonError = (error, status = 400) => Response.json({ error }, { status });
          export const adminClient = () => globalThis.__calendarFixture.ctx.sb;
          export const requireUser = async () => globalThis.__calendarFixture.ctx;`, loader: 'js',
      }));
    } }],
  });
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  return globalThis.__calendarHandler;
}

async function encryptedToken(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(secret);
  const keyBytes = await crypto.subtle.digest('SHA-256', bytes);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `${Buffer.from(iv).toString('base64')}.${Buffer.from(ciphertext).toString('base64')}`;
}

test('cancelling a meeting deletes its external event even without a scheduled date', async () => {
  const run = await handler();
  const mutations = [];
  const session = { id: 1, mentor_id: 'mentor', mentee_id: 'mentee', status: 'cancelled', scheduled_at: null, meeting_url: 'https://join.test' };
  const event = { id: 5, provider: 'google', owner_id: 'mentor', external_event_id: 'external', join_url: 'https://join.test' };
  const connection = { token_ciphertext: await encryptedToken('access-token'), token_expires_at: '2099-01-01T00:00:00Z' };
  globalThis.__calendarFixture = {
    ctx: { user: { id: 'mentee' }, sb: { from(table) {
      let action = 'select';
      let value;
      const query = {
        select() { return this; },
        eq() { return this; },
        update(next) { action = 'update'; value = next; return this; },
        delete() { action = 'delete'; return this; },
        async maybeSingle() { return { data: table === 'sessions' ? session : connection, error: null }; },
        then(resolve) {
          if (action !== 'select') mutations.push({ table, action, value });
          return Promise.resolve(resolve(action === 'select' ? { data: [event], error: null } : { error: null }));
        },
      };
      return query;
    } } },
    fetch: async (url, options) => {
      assert.match(url, /\/events\/external/);
      assert.equal(options.method, 'DELETE');
      assert.equal(options.headers.Authorization, 'Bearer access-token');
      return new Response(null, { status: 204 });
    },
  };
  const response = await run(new Request('https://fixture.invalid/calendar', { method: 'POST', body: JSON.stringify({ action: 'sync_session_events', session_id: 1 }) }));
  assert.equal(response.status, 200);
  assert.ok(mutations.some(row => row.table === 'calendar_events' && row.action === 'delete'));
  assert.ok(mutations.some(row => row.table === 'sessions' && row.action === 'update' && row.value.meeting_url === null));
  delete globalThis.__calendarFixture;
  delete globalThis.__calendarHandler;
});
