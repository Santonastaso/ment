import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('transactional email delivery uses a private Supabase scheduler token', async () => {
  const migration = await read('supabase/migrations/20261127180000_reliable_notification_delivery.sql');
  const worker = await read('supabase/functions/send-notification-outbox/index.ts');
  const config = await read('supabase/config.toml');
  const workflow = await read('.github/workflows/notification-outbox.yml');

  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/);
  assert.match(migration, /notification_worker_token_matches/);
  assert.match(migration, /revoke all on function public\.notification_worker_token_matches/);
  assert.match(migration, /grant execute on function public\.notification_worker_token_matches\(text\) to service_role/);
  assert.match(migration, /cron\.schedule\([\s\S]*?'\*\/5 \* \* \* \*'/);
  assert.match(migration, /net\.http_post/);
  assert.match(migration, /X-Notification-Worker-Token/);
  assert.match(worker, /hasWorkerToken/);
  assert.match(worker, /notification_worker_token_matches/);
  assert.match(worker, /hasServiceRole\(req\) && !\(await hasWorkerToken\(req\)\)/);
  assert.match(config, /\[functions\.send-notification-outbox\]\r?\nverify_jwt = false/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
});
