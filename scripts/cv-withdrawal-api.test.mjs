import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApiError } from '../client/src/lib/apiError.mjs';

// Exercise the owned API route with the real ApiError contract, without
// importing the browser's session client or reaching any external service.
const source = await readFile(new URL('../client/src/api/index.js', import.meta.url), 'utf8');
const start = source.indexOf("  if (url === '/users/me/consents/cv/withdraw') {");
const end = source.indexOf("\n  if (url ===", start + 1);
const route = new (async () => {}).constructor('url', 'invokeUserFunction', 'edgeFunctionError', 'ApiError', 'ok', source.slice(start, end));
const request = result => route('/users/me/consents/cv/withdraw', async (name, body) => {
  assert.equal(name, 'withdraw-cv-consent');
  assert.deepEqual(body, {});
  return result;
}, async (_error, data, fallback) => new ApiError(data?.error || fallback, 503), ApiError, data => ({ data }));

test('CV API exposes success only with explicit completed cleanup', async () => {
  assert.deepEqual(await request({ data: { withdrawn: 0, cleanup_complete: true } }), { data: { withdrawn: 0, cleanup_complete: true } });
  for (const data of [null, {}, { withdrawn: 1 }, { withdrawn: 1, cleanup_complete: false }]) {
    await assert.rejects(request({ data }), error => error.response.status === 503 && error.message === 'cv_upload_cleanup_pending');
  }
});

test('CV API preserves retryable partial failure instead of presenting permission withdrawal as success', async () => {
  await assert.rejects(request({ error: {}, data: { error: 'cv_upload_cleanup_pending', withdrawn: 1, cleanup_complete: false } }), /cv_upload_cleanup_pending/);
  await assert.rejects(request({ data: { error: 'cv_withdrawal_unavailable' } }), /cv_withdrawal_unavailable/);
});
