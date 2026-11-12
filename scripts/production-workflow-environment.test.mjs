import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const productionWorkers = [
  '.github/workflows/notification-outbox.yml',
  '.github/workflows/calendar-sync.yml',
];

for (const workflowPath of productionWorkers) {
  test(`${workflowPath} reads protected secrets from the production environment`, async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    assert.match(workflow, /^\s{4}environment: production$/m);
    assert.match(workflow, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/);
    assert.match(
      workflow,
      /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/,
    );
  });
}
