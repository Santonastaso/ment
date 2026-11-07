import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowFile = new URL('../.github/workflows/data-retention.yml', import.meta.url);

test('retention report is manual, read-only, main-only and uses Production credentials', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  const report = workflow.split(/^  report:\s*$/m)[1]?.split(/^  apply:\s*$/m)[0] || '';
  assert.match(report, /github\.event_name == 'workflow_dispatch'/);
  assert.match(report, /github\.ref == 'refs\/heads\/main'/);
  assert.match(report, /inputs\.mode == 'report'/);
  assert.match(report, /environment: Production/);
  assert.match(report, /x-retention-mode: report/);
  assert.doesNotMatch(report, /RETENTION_ENABLED/);
  assert.match(report, /cancel-in-progress: false/);
});

test('retention apply requires main, the kill switch and exact manual confirmation', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  const apply = workflow.split(/^  apply:\s*$/m)[1]?.split(/^  retention-state:\s*$/m)[0] || '';
  assert.match(apply, /github\.ref == 'refs\/heads\/main'/);
  assert.match(apply, /vars\.RETENTION_ENABLED == 'true'/);
  assert.match(apply, /inputs\.mode == 'apply'/);
  assert.match(apply, /inputs\.apply_confirmation == 'APPLY_APPROVED_RETENTION'/);
  assert.match(apply, /environment: Production/);
  assert.match(apply, /x-retention-mode: apply/);
  assert.match(apply, /cancel-in-progress: false/);
  assert.match(workflow, /^permissions:\s*\{\s*\}\s*$/m);
});

test('scheduled retention passes validation but still uses the apply kill switch', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  const validation = workflow.split(/^  validate-dispatch:\s*$/m)[1]?.split(/^  report:\s*$/m)[0] || '';
  assert.match(validation, /EVENT_NAME.*github\.event_name/s);
  assert.match(validation, /EVENT_NAME.*schedule/s);
  assert.match(validation, /RETENTION_ENABLED.*vars\.RETENTION_ENABLED/s);
  assert.match(validation, /Retention apply is disabled by RETENTION_ENABLED/);
  assert.match(workflow, /needs: \[validate-dispatch\]/);
});

test('retention API responses are allowlisted to counts before reaching summaries', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  assert.equal((workflow.match(/jq -e '\.mode ==/g) || []).length, 2);
  assert.equal((workflow.match(/select\(\.key != "mode"\)/g) || []).length, 2);
  assert.equal((workflow.match(/\(keys \| sort\) ==/g) || []).length, 2);
  assert.match(workflow, /"organizations_configured"/);
  assert.match(workflow, /"account_erasure_deferred"/);
  assert.doesNotMatch(workflow, /fail-with-body/);
});

test('disabled retention remains visible through an independent uncredentialed job', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  const stateJob = workflow.split(/^  retention-state:\s*$/m)[1];
  assert.ok(stateJob);
  assert.match(stateJob, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(stateJob, /RETENTION_ENABLED: \$\{\{ vars\.RETENTION_ENABLED \}\}/);
  assert.match(stateJob, /Retention apply is disabled/);
  assert.doesNotMatch(stateJob, /SUPABASE_SERVICE_ROLE_KEY|functions\/v1\/retention-sweep/);
});
