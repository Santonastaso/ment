import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectStaleProfileUploads, removeStaleProfileUploads } from '../supabase/functions/_shared/profile-uploads.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CUTOFF = '2026-10-29T00:00:00.000Z';

function storageFixture(objects, { listError = false, removeError = false } = {}) {
  const remaining = new Map(Object.entries(objects));
  const removed = [];
  const bucket = {
    async list(prefix, { limit, offset }) {
      if (listError) return { error: new Error('backend detail') };
      const children = new Map();
      for (const [path, dates] of remaining) {
        if (prefix && !path.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? path.slice(prefix.length + 1) : path;
        const [name, ...nested] = rest.split('/');
        if (!children.has(name)) children.set(name, nested.length ? null : dates);
      }
      const entries = [...children].sort(([a], [b]) => a.localeCompare(b)).map(([name, dates]) =>
        dates ? { name, id: 'object-id', ...dates } : { name, id: null, metadata: null });
      return { data: entries.slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (removeError) return { error: new Error('backend detail') };
      removed.push(...paths);
      for (const path of paths) remaining.delete(path);
      return { data: paths.map(name => ({ name })), error: null };
    },
  };
  return { storage: { from(name) { assert.equal(name, 'profile-uploads'); return bucket; } }, removed, remaining };
}

test('stale CV sweep removes old uploads for active users and preserves recent or undated files', async () => {
  const fixture = storageFixture({
    [`${USER}/old.pdf`]: { created_at: '2026-10-20T00:00:00Z' },
    [`${USER}/new.pdf`]: { created_at: '2026-11-01T00:00:00Z' },
    [`${USER}/replaced.pdf`]: { created_at: '2026-10-20T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
    [`${USER}/undated.pdf`]: {},
    [`${OTHER}/nested/old.docx`]: { updated_at: '2026-10-21T00:00:00Z' },
    'unexpected/old.pdf': { created_at: '2026-10-20T00:00:00Z' },
  });
  assert.deepEqual(await removeStaleProfileUploads(fixture.storage, CUTOFF), { removed: 2, undated: 1 });
  assert.deepEqual(fixture.removed.sort(), [`${OTHER}/nested/old.docx`, `${USER}/old.pdf`].sort());
  assert.equal(fixture.remaining.has(`${USER}/new.pdf`), true);
  assert.equal(fixture.remaining.has('unexpected/old.pdf'), true);
  assert.deepEqual(await removeStaleProfileUploads(fixture.storage, CUTOFF), { removed: 0, undated: 1 });
});

test('stale CV report counts eligible uploads without deleting them', async () => {
  const fixture = storageFixture({
    [`${USER}/old.pdf`]: { created_at: '2026-10-20T00:00:00Z' },
    [`${USER}/new.pdf`]: { created_at: '2026-11-01T00:00:00Z' },
    [`${OTHER}/nested/old.docx`]: { updated_at: '2026-10-21T00:00:00Z' },
    [`${USER}/undated.pdf`]: {},
  });
  assert.deepEqual(await inspectStaleProfileUploads(fixture.storage, CUTOFF), { eligible: 2, undated: 1 });
  assert.deepEqual(fixture.removed, []);
  assert.equal(fixture.remaining.size, 4);
});

test('stale CV sweep paginates without losing objects after deletion', async () => {
  const objects = {};
  for (let index = 0; index < 215; index++) {
    objects[`${USER}/${String(index).padStart(3, '0')}.pdf`] = {
      created_at: index % 2 ? '2026-11-01T00:00:00Z' : '2026-10-20T00:00:00Z',
    };
  }
  const fixture = storageFixture(objects);
  assert.deepEqual(await removeStaleProfileUploads(fixture.storage, CUTOFF), { removed: 108, undated: 0 });
  assert.equal(fixture.removed.length, 108);
  assert.equal(fixture.remaining.size, 107);
});

test('stale CV sweep visits user prefixes beyond the first root page', async () => {
  const objects = {};
  for (let index = 0; index < 105; index++) {
    const userId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    objects[`${userId}/old.pdf`] = { created_at: '2026-10-20T00:00:00Z' };
  }
  const fixture = storageFixture(objects);
  assert.deepEqual(await removeStaleProfileUploads(fixture.storage, CUTOFF), { removed: 105, undated: 0 });
  assert.equal(fixture.remaining.size, 0);
});

test('stale CV sweep fails closed on inventory or removal errors', async () => {
  const objects = { [`${USER}/old.pdf`]: { created_at: '2026-10-20T00:00:00Z' } };
  await assert.rejects(removeStaleProfileUploads(storageFixture(objects, { listError: true }).storage, CUTOFF), /profile_upload_list_failed/);
  await assert.rejects(removeStaleProfileUploads(storageFixture(objects, { removeError: true }).storage, CUTOFF), /profile_upload_remove_failed/);
  await assert.rejects(removeStaleProfileUploads(storageFixture(objects).storage, 'invalid'), /profile_upload_invalid_cutoff/);
});

test('disabled retention remains visible through an independent uncredentialed job', async () => {
  const workflow = await readFile(new URL('../.github/workflows/data-retention.yml', import.meta.url), 'utf8');
  const stateJob = workflow.split(/^  retention-state:\s*$/m)[1];
  assert.ok(stateJob);
  assert.match(stateJob, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(stateJob, /RETENTION_ENABLED: \$\{\{ vars\.RETENTION_ENABLED \}\}/);
  assert.match(stateJob, /Retention apply is disabled/);
  assert.doesNotMatch(stateJob, /SUPABASE_SERVICE_ROLE_KEY|functions\/v1\/retention-sweep/);
});
