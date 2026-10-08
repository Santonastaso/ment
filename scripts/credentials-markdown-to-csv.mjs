import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function toCsv(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => /^\|\s*Email\s*\|\s*Temporary password\s*\|\s*Status\s*\|\s*$/i.test(line.trim()));
  if (start < 0 || !/^\|[\s:|-]+\|$/.test(lines[start + 1]?.trim() || '')) {
    throw new Error('Expected an Email | Temporary password | Status Markdown table');
  }

  const rows = [];
  const seen = new Set();
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break;
    const cells = line.trim().slice(1, -1).split('|').map(cell => cell.trim());
    if (cells.length !== 3) throw new Error(`Invalid table row ${rows.length + 1}`);
    const [email, wrappedPassword, status] = cells;
    const password = wrappedPassword.startsWith('`') && wrappedPassword.endsWith('`')
      ? wrappedPassword.slice(1, -1) : wrappedPassword;
    if (!/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(email) || !password || !['Created', 'Already created'].includes(status)) {
      throw new Error(`Invalid table row ${rows.length + 1}`);
    }
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) throw new Error(`Duplicate email: ${email}`);
    seen.add(normalized);
    rows.push([email, password, status]);
  }
  if (!rows.length) throw new Error('No account rows found');
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  return ['email,temporary_password,status', ...rows.map(row => row.map(quote).join(','))].join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node scripts/credentials-markdown-to-csv.mjs input.md|- output.csv');
    process.exitCode = 1;
  } else {
    try {
      const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      const destination = resolve(output);
      const pathFromRepository = relative(repository, destination);
      if (!pathFromRepository || (!pathFromRepository.startsWith(`..${sep}`) && pathFromRepository !== '..' && !isAbsolute(pathFromRepository))) {
        throw new Error('Write the password CSV outside the Git repository');
      }
      const csv = toCsv(readFileSync(input === '-' ? 0 : input, 'utf8'));
      writeFileSync(output, csv, { flag: 'wx', mode: 0o600 });
      console.log(`Wrote ${csv.split('\n').length - 2} accounts to ${output}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
