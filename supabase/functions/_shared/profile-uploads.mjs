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
