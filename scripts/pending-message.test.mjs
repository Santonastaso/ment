import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginPendingMessage, finishPendingMessage, pendingDrafts, pendingMessage } from '../client/src/lib/pendingMessage.mjs';

function storage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test('pending sends reuse their ID, restore drafts and clear only the completed send', () => {
  const tab = storage();
  const first = beginPendingMessage(tab, 'viewer', 'session:1', 'Hello');
  assert.equal(beginPendingMessage(tab, 'viewer', 'session:1', 'Hello'), first);
  assert.deepEqual(pendingDrafts(tab, 'viewer'), { 'session:1': 'Hello' });
  assert.deepEqual(pendingDrafts(tab, 'someone-else'), {});

  const newer = beginPendingMessage(tab, 'viewer', 'session:1', 'Changed text');
  assert.notEqual(newer, first);
  finishPendingMessage(tab, 'viewer', 'session:1', first);
  assert.equal(pendingMessage(tab, 'viewer', 'session:1')?.id, newer);
  finishPendingMessage(tab, 'viewer', 'session:1', newer);
  assert.deepEqual(pendingDrafts(tab, 'viewer'), {});
});
