import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from './credentials-markdown-to-csv.mjs';

const table = `Intro\n| Email | Temporary password | Status |\n|---|---|---|\n| A@example.com | \`test,!"\` | Already created |\n| b@example.com | \`second\` | Created |\n\nOther text`;

test('converts the account table without changing order, casing or passwords', () => {
  assert.equal(toCsv(table), 'email,temporary_password,status\n"A@example.com","test,!""","Already created"\n"b@example.com","second","Created"\n');
});

test('rejects duplicate addresses and malformed rows', () => {
  assert.throws(() => toCsv(table.replace('b@example.com', 'a@example.com')), /Duplicate email/);
  assert.throws(() => toCsv(table.replace('Created |', 'Unknown |')), /Invalid table row/);
});
