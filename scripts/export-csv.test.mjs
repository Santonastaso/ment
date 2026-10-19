import test from 'node:test';
import assert from 'node:assert/strict';
import { exportToCsv } from '../client/src/lib/exportCsv.mjs';

test('the data export becomes one spreadsheet-safe CSV', () => {
  const csv = exportToCsv({
    format: 'ment-export-1',
    profile: { name: 'Zoë "Z" Martin', bio: 'Line one\nline two' },
    skills: [{ skill: 'Valuation' }, { skill: '=HYPERLINK("x")' }],
    discovery_threads: [{ turns: [{ role: 'user', content: 'Finance, M&A' }] }],
    consents: [],
  });
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Section,Item,Field,Value');
  assert.equal(lines[1], 'export,,format,ment-export-1');
  assert.equal(lines[2], 'profile,,name,"Zoë ""Z"" Martin"');
  assert.ok(csv.includes('profile,,bio,"Line one\nline two"'));
  assert.ok(csv.includes('skills,1,skill,Valuation'));
  // A formula is written as text, never run.
  assert.ok(csv.includes(`skills,2,skill,"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('discovery_threads,1,turns,"[{""role"":""user"",""content"":""Finance, M&A""}]"'));
  assert.ok(!csv.includes('consents'));
});
