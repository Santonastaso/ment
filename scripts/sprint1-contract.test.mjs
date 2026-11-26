import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('Sprint 1 conversation deletion is per-member and does not delete shared sessions', async () => {
  const migration = await read('supabase/migrations/20261126120000_sprint1_conversation_and_group_notifications.sql');
  assert.match(migration, /add column if not exists deleted_at/);
  assert.match(migration, /create or replace function public\.delete_peer_conversation/);
  assert.match(migration, /insert into public\.peer_conversation_preferences/);
  assert.match(migration, /prefs\.deleted_at is null or s\.last_activity_at > prefs\.deleted_at/);
  assert.doesNotMatch(migration, /delete from public\.sessions/);
});

test('Sprint 1 group notifications and server errors use stable contracts', async () => {
  const migration = await read('supabase/migrations/20261126120000_sprint1_conversation_and_group_notifications.sql');
  const worker = await read('supabase/functions/send-notification-outbox/index.ts');
  const invite = await read('supabase/functions/admin-create-invitation/index.ts');
  const reflection = await read('supabase/functions/reflection-classify/index.ts');
  assert.match(migration, /group_join_request_received/);
  assert.match(worker, /group_join_request_received/);
  assert.doesNotMatch(invite, /invitation_create_failed: \$\{error\.message\}/);
  assert.doesNotMatch(reflection, /read_failed: \$\{error\.message\}/);
});
