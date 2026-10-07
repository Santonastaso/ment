const prefix = 'ment.pending-message:';
const memory = new Map();

function key(userId, threadKey) {
  return `${prefix}${userId}:${threadKey}`;
}

export function pendingMessage(storage, userId, threadKey) {
  const storageKey = key(userId, threadKey);
  try {
    const saved = storage.getItem(storageKey);
    if (saved) return JSON.parse(saved);
  } catch { /* Storage can be disabled; retain retries in memory. */ }
  return memory.get(storageKey) || null;
}

export function beginPendingMessage(storage, userId, threadKey, body) {
  const storageKey = key(userId, threadKey);
  const existing = pendingMessage(storage, userId, threadKey);
  if (existing?.body === body && existing.id) return existing.id;
  const next = { id: crypto.randomUUID(), body };
  memory.set(storageKey, next);
  try { storage.setItem(storageKey, JSON.stringify(next)); } catch { /* Memory still covers this tab. */ }
  return next.id;
}

export function finishPendingMessage(storage, userId, threadKey, id) {
  if (pendingMessage(storage, userId, threadKey)?.id !== id) return;
  const storageKey = key(userId, threadKey);
  memory.delete(storageKey);
  try { storage.removeItem(storageKey); } catch { /* No persistent copy to remove. */ }
}

export function pendingDrafts(storage, userId) {
  const drafts = {};
  const userPrefix = `${prefix}${userId}:`;
  try {
    for (let i = 0; i < storage.length; i++) {
      const storageKey = storage.key(i);
      if (!storageKey?.startsWith(userPrefix)) continue;
      const threadKey = storageKey.slice(userPrefix.length);
      const saved = pendingMessage(storage, userId, threadKey);
      if (saved?.id && saved.body) drafts[threadKey] = saved.body;
    }
  } catch { /* Storage can be disabled. */ }
  return drafts;
}
