import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowFile = new URL('../.github/workflows/recovery-drill.yml', import.meta.url);

test('recovery drill runs on pull requests or an exactly confirmed main dispatch, and stays synthetic-local', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(workflow, /github\.event_name == 'pull_request'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /RESTORE_SYNTHETIC_LOCAL_DATA_ONLY/);
  assert.match(workflow, /Refusing to run the recovery drill against a non-local Supabase instance|recovery-drill\.py/);
  assert.doesNotMatch(workflow, /environment:\s*(Production|Preview)/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test('recovery drill isolates restore and reapplies erasure before evidence', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  const restore = workflow.indexOf('Restore the pre-erasure backup in isolation');
  const reapply = workflow.indexOf('Reapply the erasure decision before any access');
  const evidence = workflow.indexOf('Write sanitized drill evidence');
  assert.ok(restore > 0 && reapply > restore && evidence > reapply);
  assert.match(workflow, /createdb.*ment_recovery/);
  assert.match(workflow, /createdb.*--owner supabase_admin/);
  assert.match(workflow, /pg_restore.*--username supabase_admin/s);
  assert.match(workflow, /pg_restore --list.*grep -v.*EXTENSION - pg_cron/s);
  assert.match(workflow, /restore manifest still contains pg_cron/);
  assert.match(workflow, /--use-list \/tmp\/ment-restore\.list/);
  assert.match(workflow, /erase_account_data/);
  assert.match(workflow, /update auth\.users/);
  assert.match(workflow, /banned_until > now\(\)/);
  assert.match(workflow, /AI_PROCESSING_ENABLED: 'false'/);
  assert.match(workflow, /CALENDAR_SYNC_ENABLED: 'false'/);
  assert.match(workflow, /NOTIFICATIONS_ENABLED: 'false'/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /\$\{\{[^}]*SUPABASE_(URL|SERVICE_ROLE_KEY)/);
});

test('sanitized recovery evidence contains outcomes but no fixture identity', async () => {
  const report = await readFile(new URL('./recovery-drill-report.mjs', import.meta.url), 'utf8');
  assert.match(report, /synthetic_local_backup_recovery_drill/);
  assert.match(report, /limitations/);
  assert.doesNotMatch(report, /user_id|email|decision_file|SUPABASE_SERVICE_ROLE_KEY/);
});
