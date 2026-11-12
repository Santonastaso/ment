import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeliverable, isDeliverableEmail, messageFor } from '../supabase/functions/_shared/notification-content.mjs';

const now = Date.parse('2026-09-29T12:00:00Z');
const mentor = 'mentor-id';
const mentee = 'mentee-id';
const session = { mentor_id: mentor, mentee_id: mentee, status: 'pending', scheduled_at: null };
const row = (topic, user_id, payload = { session_id: 42 }, created_at = '2026-09-29T11:00:00Z') =>
  ({ topic, user_id, payload, created_at });

test('templates link to the conversation without trusting user text', () => {
  const message = messageFor('session_request_received', { session_id: 42 }, 'https://ment-labs.com', 'abcdefghijklmnop');
  assert.equal(message.subject, 'You have a new MENT request');
  assert.match(message.text, /\/c\/abcdefghijklmnop/);
  assert.doesNotMatch(messageFor('session_request_received', { session_id: 42 }, 'https://ment-labs.com').text, /session=42/);
  assert.equal(messageFor('session_request_received', { session_id: 'bad' }, 'https://ment-labs.com'), null);
});

test('request is sent only to the mentor while pending', () => {
  assert.equal(isDeliverable(row('session_request_received', mentor), session, now), true);
  assert.equal(isDeliverable(row('session_request_received', mentee), session, now), false);
  assert.equal(isDeliverable(row('session_request_received', mentor), { ...session, status: 'cancelled' }, now), false);
});

test('acceptance is sent only to the requester for an accepted session', () => {
  const accepted = { ...session, status: 'scheduled' };
  assert.equal(isDeliverable(row('session_request_accepted', mentee), accepted, now), true);
  assert.equal(isDeliverable(row('session_request_accepted', mentor), accepted, now), false);
});

test('reminder is discarded after rescheduling or cancellation', () => {
  const payload = { session_id: 42, scheduled_at: '2026-09-30T10:00:00Z' };
  const reminder = row('meeting_reminder', mentor, payload);
  const booked = { ...session, status: 'scheduled', scheduled_at: payload.scheduled_at };
  assert.equal(isDeliverable(reminder, booked, now), true);
  assert.equal(isDeliverable(reminder, { ...booked, scheduled_at: '2026-09-30T11:00:00Z' }, now), false);
  assert.equal(isDeliverable(reminder, { ...booked, status: 'cancelled' }, now), false);
});

test('old queued mail is not sent during first enablement', () => {
  assert.equal(isDeliverable(row('reflection_reminder', mentor, {}, '2026-09-20T12:00:00Z'), null, now), false);
  assert.equal(isDeliverable(row('session_request_received', mentor, undefined, '2026-09-26T12:00:00Z'), session, now), false);
});

test('message notification contains no member-written content and expires once read', () => {
  const payload = { session_id: 42, message_id: 9 };
  const notification = row('session_message_received', mentor, payload);
  const message = {
    id: 9, session_id: 42, sender_id: mentee, kind: 'message',
    created_at: '2026-09-29T11:00:00Z', last_read_at: null,
  };
  const content = messageFor('session_message_received', payload, 'https://ment-labs.com', 'abcdefghijklmnop');
  assert.match(content.text, /\/c\/abcdefghijklmnop/);
  assert.doesNotMatch(content.text, /private words/i);
  assert.equal(isDeliverable(notification, session, now, message), true);
  assert.equal(isDeliverable(notification, session, now, { ...message, last_read_at: message.created_at }), false);
  assert.equal(isDeliverable(notification, session, now, { ...message, sender_id: mentor }), false);
});

test('reserved and configured test domains never reach the email provider', () => {
  assert.equal(isDeliverableEmail('member@essec.edu', ['ment.io']), true);
  assert.equal(isDeliverableEmail('demo@ment.invalid'), false);
  assert.equal(isDeliverableEmail('demo@example.test'), false);
  assert.equal(isDeliverableEmail('demo@ment.io', ['ment.io']), false);
  assert.equal(isDeliverableEmail('not-an-email'), false);
});
