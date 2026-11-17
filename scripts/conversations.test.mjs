import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationState, CONVERSATION_FILTERS, requestText, resumableSearch, clearSentDraft, canCompleteMeeting, meetingFeedback, conversationThreads, peerConversationSessions, conversationUnreadCount } from '../client/src/lib/conversations.mjs';

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

test('sending clears only the original thread draft and never newer typing', () => {
  const drafts = { 'session:1': 'Send A', 'group:1': 'Keep B' };
  assert.deepEqual(clearSentDraft(drafts, 'session:1', 'Send A'), { 'group:1': 'Keep B' });
  assert.equal(clearSentDraft(drafts, 'session:1', 'Earlier A'), drafts);
  assert.equal(drafts['session:1'], 'Send A');
});

test('meeting feedback is private to the participant and completion is not re-stamped', () => {
  const meeting = { status: 'scheduled', scheduled_at: '2026-09-30', isMentor: true };
  assert.equal(canCompleteMeeting(meeting, now), true);
  assert.equal(canCompleteMeeting({ ...meeting, scheduled_at: '2026-10-02' }, now), false);
  assert.equal(canCompleteMeeting({ ...meeting, scheduled_at: null }, now), false);
  assert.equal(canCompleteMeeting({ ...meeting, status: 'pending' }, now), false);
  assert.deepEqual(meetingFeedback(meeting, ' Useful ', 4), { status: 'completed', mentor_reflection: 'Useful', mentor_rating: 4 });
  assert.deepEqual(meetingFeedback({ ...meeting, isMentor: false, viewer_completed: true }, '', null), { reflection: null, mentee_rating: null });
});

test('repeated mentoring sessions form one peer conversation', () => {
  const sessions = [
    { id: 1, mentor_id: 'mentor', mentee_id: 'viewer', created_at: '2026-09-01', last_activity_at: '2026-09-02' },
    { id: 2, mentor_id: 'mentor', mentee_id: 'viewer', created_at: '2026-10-01', last_activity_at: '2026-10-02' },
    { id: 3, mentor_id: 'other', mentee_id: 'viewer', created_at: '2026-09-15', last_activity_at: '2026-09-16' },
  ];
  assert.deepEqual(conversationThreads(sessions, 'viewer').map(session => session.id), [2, 3]);
  assert.deepEqual(peerConversationSessions(sessions, sessions[0], 'viewer').map(session => session.id), [2, 1]);
  assert.equal(conversationUnreadCount(peerConversationSessions(sessions, sessions[0], 'viewer'), { 1: 2, 2: 3 }), 5);
});
test('internal criteria stay private and only unfinished searches resume', () => {
  assert.equal(requestText('{"role":"finance"}', 'Finance advice'), 'Finance advice');
  assert.equal(requestText('["finance"]', 'Finance advice'), 'Finance advice');
  assert.equal(requestText('Finance advice'), 'Finance advice');
  assert.equal(resumableSearch({ id: '1', turns: [{ role: 'assistant', kind: 'matches' }] }), true);
  assert.equal(resumableSearch({ id: '1', archived: true, turns: [{ role: 'assistant', kind: 'draft' }] }), false);
  assert.equal(resumableSearch({ id: '1', turns: [{ role: 'assistant', kind: 'no_match' }] }), false);
});
