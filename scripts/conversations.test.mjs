import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationState, CONVERSATION_FILTERS, requestText, resumableSearch } from '../client/src/lib/conversations.mjs';

const now = Date.parse('2026-10-01T12:00:00Z');
test('Home and Messages use identical request and meeting states', () => {
  assert.equal(conversationState({ status: 'pending', isMentor: true }, now), 'needs');
  assert.equal(conversationState({ status: 'pending', isMentor: false }, now), 'waiting');
  assert.equal(conversationState({ status: 'pending', request_expires_at: '2026-09-30' }, now), 'closed');
  assert.equal(conversationState({ status: 'scheduled', scheduled_at: '2026-10-02' }, now), 'scheduled');
  assert.equal(conversationState({ status: 'scheduled', scheduled_at: '2026-09-30' }, now), 'needs');
  assert.equal(conversationState({ status: 'scheduled', viewer_completed: true }, now), 'past');
  assert.ok(CONVERSATION_FILTERS.find(f => f.key === 'past').match('closed'));
});
test('internal criteria stay private and only unfinished searches resume', () => {
  assert.equal(requestText('{"role":"finance"}', 'Finance advice'), 'Finance advice');
  assert.equal(requestText('["finance"]', 'Finance advice'), 'Finance advice');
  assert.equal(requestText('Finance advice'), 'Finance advice');
  assert.equal(resumableSearch({ id: '1', turns: [{ role: 'assistant', kind: 'matches' }] }), true);
  assert.equal(resumableSearch({ id: '1', archived: true, turns: [{ role: 'assistant', kind: 'draft' }] }), false);
  assert.equal(resumableSearch({ id: '1', turns: [{ role: 'assistant', kind: 'no_match' }] }), false);
});
