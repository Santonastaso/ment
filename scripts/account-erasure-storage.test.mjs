import test from 'node:test';
import assert from 'node:assert/strict';
import { removeUserProfileUploads } from '../supabase/functions/_shared/profile-uploads.mjs';

function fakeStorage(entries, { listError, removeError } = {}) {
  const removed = [];
  const remaining = new Set(entries);
  const bucket = {
    async list(prefix, { limit, offset }) {
      if (listError) return { data: null, error: new Error('private backend detail') };
      const names = new Map();
      for (const path of remaining) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1);
        const slash = rest.indexOf('/');
        const name = slash < 0 ? rest : rest.slice(0, slash);
        names.set(name, names.get(name) || slash >= 0);
      }
      const matching = [...names.entries()].map(([name, hasNestedChildren]) => {
        return { name, id: hasNestedChildren ? null : 'object-id', metadata: hasNestedChildren ? null : {} };
      }).sort((a, b) => a.name.localeCompare(b.name));
      return { data: matching.slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (removeError) return { data: null, error: new Error('private backend detail') };
      removed.push(...paths);
      for (const path of paths) remaining.delete(path);
      return { data: paths.map(name => ({ name })), error: null };
    },
  };
  return { storage: { from: name => { assert.equal(name, 'profile-uploads'); return bucket; } }, removed };
}

test('account erasure removes every upload below the caller prefix, including nested files', async () => {
  const fixture = fakeStorage([
    'user-a/cv.pdf', 'user-a/archive/old.docx', 'user-b/keep.pdf',
  ]);
  const removed = await removeUserProfileUploads(fixture.storage, 'user-a');
  assert.equal(removed, 2);
  assert.deepEqual(fixture.removed.sort(), ['user-a/archive/old.docx', 'user-a/cv.pdf']);
});

test('account erasure fails closed if storage listing or deletion fails', async () => {
  const listFixture = fakeStorage(['user-a/cv.pdf'], { listError: true });
  await assert.rejects(removeUserProfileUploads(listFixture.storage, 'user-a'), /profile_upload_list_failed/);

  const removeFixture = fakeStorage(['user-a/cv.pdf'], { removeError: true });
  await assert.rejects(removeUserProfileUploads(removeFixture.storage, 'user-a'), /profile_upload_remove_failed/);
});

test('account erasure continues through inventories larger than one listing page', async () => {
  const paths = Array.from({ length: 10001 }, (_, index) => `user-a/${String(index).padStart(5, '0')}.pdf`);
  const fixture = fakeStorage(paths);
  assert.equal(await removeUserProfileUploads(fixture.storage, 'user-a'), paths.length);
  assert.equal(fixture.removed.length, paths.length);
});
