import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
const seen = new Map();
let errors = 0;
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql'))) {
  const version = file.match(/^(\d+)_/)?.[1];
  if (!version) {
    console.error(`Migration has no version: ${file}`);
    errors++;
  } else if (seen.has(version)) {
    console.error(`Migration version ${version} is shared by ${seen.get(version)} and ${file}`);
    errors++;
  } else {
    seen.set(version, file);
  }
}
if (errors) process.exit(1);
console.log(`${seen.size} migration versions are unique.`);
