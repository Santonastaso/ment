#!/usr/bin/env node
// Apply a SQL file (or piped SQL) to the Supabase project via the Management API.
// Usage:
//   node scripts/db-query.mjs supabase/migrations/0001_init.sql
//   echo "select 1" | node scripts/db-query.mjs

import fs from 'node:fs';

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!PAT || !REF) {
  console.error('SUPABASE_PAT and SUPABASE_PROJECT_REF must be set (source .env)');
  process.exit(1);
}

const file = process.argv[2];
const sql = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
if (!sql.trim()) {
  console.error('No SQL provided');
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(text);
  process.exit(1);
}
process.stdout.write(text + '\n');
