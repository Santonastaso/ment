import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manual retention dispatch cannot bypass the production kill switch or run off main', async () => {
  const workflow = await readFile(new URL('../.github/workflows/data-retention.yml', import.meta.url), 'utf8');
  const guard = workflow.match(/^\s+if:\s*(.+)$/m)?.[1] || '';
  assert.match(guard, /vars\.RETENTION_ENABLED\s*==\s*'true'/);
  assert.match(guard, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.doesNotMatch(guard, /workflow_dispatch\s*\|\|/);
  assert.match(workflow, /^permissions:\s*\{\s*\}\s*$/m);
});
