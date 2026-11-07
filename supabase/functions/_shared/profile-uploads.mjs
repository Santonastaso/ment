const PAGE_SIZE = 100;
const DELETE_BATCH_SIZE = 100;

/** Remove every object below a user's private profile-upload prefix. */
export async function removeUserProfileUploads(storage, userId) {
  const bucket = storage.from('profile-uploads');
  let removedCount = 0;

  async function removePrefix(prefix) {
    while (true) {
      const { data, error } = await bucket.list(prefix, {
        limit: PAGE_SIZE,
        // Delete from the start each time so removals cannot shift objects
        // past an offset. Progress is durable between retries.
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error('profile_upload_list_failed');
      const entries = data || [];
      if (entries.length === 0) return;
      const files = [];
      const folders = [];
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id || entry.metadata) files.push(path);
        else folders.push(path);
      }

      if (files.length) {
        for (let offset = 0; offset < files.length; offset += DELETE_BATCH_SIZE) {
          const batch = files.slice(offset, offset + DELETE_BATCH_SIZE);
          const { error: removeError } = await bucket.remove(batch);
          if (removeError) throw new Error('profile_upload_remove_failed');
          removedCount += batch.length;
        }
        continue;
      }
      if (folders.length) {
        for (const folder of folders) await removePrefix(folder);
        continue;
      }
      return;
    }
  }

  await removePrefix(userId);
  return removedCount;
}

/** Remove transient CV uploads older than cutoff, including uploads for active accounts.
 * Listing completes before deletion so changing page offsets cannot hide objects.
 */
async function findStaleProfileUploads(storage, cutoff) {
  const bucket = storage.from('profile-uploads');
  const cutoffMs = new Date(cutoff).getTime();
  if (!Number.isFinite(cutoffMs)) throw new Error('profile_upload_invalid_cutoff');
  const stalePaths = [];
  let undated = 0;

  async function scan(prefix) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await bucket.list(prefix, {
        limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error('profile_upload_list_failed');
      const entries = data || [];
      for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id && !entry.metadata) {
          // Profile uploads live below a user UUID. Ignore unexpected root paths.
          if (prefix || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name)) {
            await scan(path);
          }
          continue;
        }
        if (!prefix) continue;
        const lastChanged = Date.parse(entry.updated_at || entry.created_at || '');
        if (!Number.isFinite(lastChanged)) {
          undated += 1;
        } else if (lastChanged < cutoffMs) {
          stalePaths.push(path);
        }
      }
      if (entries.length < PAGE_SIZE) break;
    }
  }

  await scan('');
  return { paths: stalePaths, undated };
}

/** Count transient uploads eligible for removal without changing Storage. */
export async function inspectStaleProfileUploads(storage, cutoff) {
  const { paths, undated } = await findStaleProfileUploads(storage, cutoff);
  return { eligible: paths.length, undated };
}

export async function removeStaleProfileUploads(storage, cutoff) {
  const bucket = storage.from('profile-uploads');
  const { paths: stalePaths, undated } = await findStaleProfileUploads(storage, cutoff);
  for (let offset = 0; offset < stalePaths.length; offset += DELETE_BATCH_SIZE) {
    const { error } = await bucket.remove(stalePaths.slice(offset, offset + DELETE_BATCH_SIZE));
    if (error) throw new Error('profile_upload_remove_failed');
  }
  return { removed: stalePaths.length, undated };
}
