import test from 'node:test';
import assert from 'node:assert/strict';
import { mistralJson } from '../supabase/functions/_shared/mistral.ts';

test('schema-constrained Mistral responses accept text chunks', async () => {
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const schema = { type: 'object', properties: { proposed: { type: 'object' } }, required: ['proposed'] };
  globalThis.Deno = { env: { get: (key) => ({ AI_PROCESSING_ENABLED: 'true', MISTRAL_API: 'test-key' })[key] || '' } };
  try {
    globalThis.fetch = async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.deepEqual(body.response_format, {
        type: 'json_schema', json_schema: { name: 'profile_ingest', schema, strict: true },
      });
      return Response.json({ model: 'test-model', choices: [{ message: { content: [{ type: 'text', text: '{"proposed":{}}' }] } }] });
    };
    const result = await mistralJson({ feature: 'profile_ingest', system: 'Return JSON', user: 'Synthetic CV', schema });
    assert.deepEqual(result.value, { proposed: {} });
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
});
