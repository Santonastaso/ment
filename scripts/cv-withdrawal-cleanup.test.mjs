import test from 'node:test';
import assert from 'node:assert/strict';
import { createWithdrawCvConsentHandler } from '../supabase/functions/_shared/withdraw-cv-consent.mjs';

function fixture(paths = [], options = {}) {
  const remaining = new Set(paths);
  const calls = [];
  let withdrawals = 0;
  let removals = 0;
  const bucket = {
    async list(prefix, { limit, offset }) {
      calls.push(['list', prefix, offset]);
      assert.equal(offset, 0);
      assert.equal(withdrawals > 0, true, 'revoke permission/drafts before touching storage');
      if (options.listThrows) throw new Error('private storage detail');
      if (options.listError) return { error: new Error('private storage detail') };
      if (options.nullList) return { data: null, error: null };
      if (options.stuck) return { data: [{ name: 'cv.pdf', id: 'object' }] };
      const children = new Map();
      for (const path of remaining) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1);
        const [name] = rest.split('/');
        children.set(name, { name, id: rest.includes('/') ? null : 'object' });
      }
      return { data: [...children.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit), error: null };
    },
    async remove(batch) {
      calls.push(['remove', batch]);
      assert.ok(batch.length <= 100);
      if (++removals === options.failRemoval) return { error: new Error('private delete detail') };
      for (const path of batch) remaining.delete(path);
      if (options.ambiguousDelete) { options.ambiguousDelete = false; throw new Error('response lost'); }
      return { error: null };
    },
  };
  const handler = createWithdrawCvConsentHandler({
    requireUser: async () => {
      calls.push(['auth']);
      if (options.unauthorized) throw new Response('denied', { status: 401 });
      return { user: { id: 'me' }, sb: { storage: { from(name) { assert.equal(name, 'profile-uploads'); return bucket; } } } };
    },
    callerClient(req) {
      assert.equal(req.headers.get('Authorization'), 'Bearer verified-caller');
      return { async rpc(name) {
        calls.push(['withdraw']);
        assert.equal(name, 'withdraw_cv_import_consent');
        if (options.rpcThrows) throw new Error('private db detail');
        if (options.rpcError) return { error: new Error('private db detail') };
        return { data: withdrawals++ === 0 ? 1 : 0, error: null };
      } };
    },
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    jsonOk: (body, status = 200) => Response.json(body, { status }),
    jsonError: (error, status) => Response.json({ error }, { status }),
  });
  return { remaining, calls, options, request: (method = 'POST') => handler(new Request('https://example.test', {
    method, headers: { Authorization: 'Bearer verified-caller' },
    ...(method === 'POST' ? { body: JSON.stringify({ user_id: 'someone-else' }) } : {}),
  })) };
}

test('withdraws first, paginates/nests deletion only under verified caller, and repeats safely', async () => {
  const f = fixture([...Array.from({ length: 305 }, (_, i) => `me/${i}.pdf`), 'me/archive/cv.docx', 'other/keep.pdf']);
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { withdrawn: 1, uploads_removed: 306, cleanup_complete: true });
  assert.deepEqual([...f.remaining], ['other/keep.pdf']);
  assert.equal((await (await f.request()).json()).withdrawn, 0);
});

test('partial deletion keeps permission withdrawn and retry drains remaining pages', async () => {
  const f = fixture(Array.from({ length: 205 }, (_, i) => `me/${i}.pdf`), { failRemoval: 2 });
  const failed = await f.request();
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'cv_upload_cleanup_pending', withdrawn: 1, cleanup_complete: false });
  assert.equal(f.remaining.size, 105);
  const retried = await f.request();
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { withdrawn: 0, uploads_removed: 105, cleanup_complete: true });
  assert.equal(f.remaining.size, 0);
});

for (const failure of ['listError', 'listThrows', 'nullList', 'stuck', 'ambiguousDelete']) {
  test(`${failure}: incomplete cleanup never produces success and stays retryable`, async () => {
    const f = fixture(['me/cv.pdf'], { [failure]: true });
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'cv_upload_cleanup_pending');
    f.options[failure] = false;
    assert.equal((await f.request()).status, 200);
    assert.equal(f.remaining.size, 0);
  });
}

for (const failure of ['rpcError', 'rpcThrows']) {
  test(`${failure}: never deletes uploads if permission/draft withdrawal fails`, async () => {
    const f = fixture(['me/cv.pdf'], { [failure]: true });
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'cv_withdrawal_unavailable');
    assert.deepEqual(f.calls, [['auth'], ['withdraw']]);
  });
}

test('preflight, unsupported methods and invalid auth cannot mutate data', async () => {
  const f = fixture([], { unauthorized: true });
  assert.equal((await f.request('OPTIONS')).status, 200);
  assert.equal((await f.request('GET')).status, 405);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.request()).status, 401);
  assert.deepEqual(f.calls, [['auth']]);
});
