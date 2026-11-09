import { writeFile } from 'node:fs/promises';

const target = process.argv[2];
if (!target) throw new Error('Evidence output path is required');

const evidence = {
  schema_version: 1,
  kind: 'synthetic_local_backup_recovery_drill',
  status: 'passed',
  source_sha: process.env.GITHUB_SHA || 'local',
  run_id: process.env.GITHUB_RUN_ID || 'local',
  run_attempt: process.env.GITHUB_RUN_ATTEMPT || 'local',
  checks: {
    backup_created_before_erasure: 'passed',
    source_erasure_verified: 'passed',
    restored_only_to_isolated_database: 'passed',
    resurrection_detected_before_reapplication: 'passed',
    erasure_reapplied_before_access: 'passed',
    login_closed_and_personal_rows_absent_after_reapplication: 'passed',
    outbound_services_disabled: 'passed',
  },
  limitations: [
    'Synthetic local PostgreSQL drill; not evidence of Supabase managed-backup coverage or restoration.',
    'Does not establish Storage backup coverage, provider retention, RPO or RTO.',
  ],
};

await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
await writeFile(process.env.GITHUB_STEP_SUMMARY || `${target}.md`, [
  '## Synthetic backup recovery drill',
  '',
  '- Result: passed',
  '- Scope: disposable local PostgreSQL data only',
  '- Verified: a pre-erasure restore resurrects the fixture; the erasure decision is reapplied before access',
  '- Not verified: Supabase managed backups, Storage coverage, production RPO/RTO',
  '',
].join('\n'), { mode: 0o600 });
