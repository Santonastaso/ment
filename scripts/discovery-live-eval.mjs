// Runs real conversations against the deployed discovery assistant and prints
// a transcript with pass/fail checks. Meant for CI, where the Supabase access
// token lives: it signs in as one dummy account with a throwaway password and
// always clears that password afterwards.
import { randomBytes } from 'node:crypto';

const ref = process.env.SUPABASE_PROJECT_REF;
const pat = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !pat) { console.log('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN'); process.exit(1); }
const TEST_USER = '40739a80-bab8-446d-a3c3-58acf6db7b4e';
const TEST_EMAIL = 'aisha.kowalski@dummy.ment.io';
const api = `https://api.supabase.com/v1/projects/${ref}`;
const base = `https://${ref}.supabase.co`;
const fnName = process.env.DISCOVERY_FUNCTION || 'discovery-assistant';

const mgmt = async (path, init = {}) => {
  const response = await fetch(api + path, { ...init, headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' } });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json();
};
const sql = (query) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) });

const isFinance = (p) => p.department === 'Finance' || /financ/i.test(p.job_title || '');
const SCENARIOS = [
  { name: 'funnel: support -> industry -> finance -> career advice', turns: ['I am looking for support', 'industry', 'finance', 'career advice'],
    check: (t) => [/What would you like help with/.test(t[0].ask), /Which field/.test(t[1].ask), /What in finance/.test(t[2].ask),
      t[3].people.length > 0 && t[3].people.every(isFinance), !/working in career/i.test(t[3].said)] },
  { name: 'CTO 1: who are you', turns: ['Hi who are you?'], check: (t) => [/Ment/.test(t[0].ask), t[0].people.length === 0] },
  { name: 'CTO 2: slang around a department', turns: ['nevermind, im looking for someone in finance bro'], check: (t) => [/What in finance/.test(t[0].ask)] },
  { name: 'CTO 3: react to results', turns: ['I need help with LBO modelling', 'no but i want more options not just 1 shot recommendation ask me clarifying questions come on'],
    check: (t) => [t[0].people.length > 0, /narrow it down/i.test(t[1].ask)] },
  { name: 'more options after results', turns: ['someone in finance', 'either works', 'show me more options'],
    check: (t) => [t[1].people.length > 0, t[2].people.length > 0 || /everyone who fits/.test(t[2].said),
      t[2].people.every((p) => !t[1].people.some((q) => q.id === p.id)), t[2].people.every(isFinance)] },
  { name: 'proposals, asked twice', turns: ['hi how are you?', 'can you propose some people to me?', 'I would like you to propose some people to me'],
    check: (t) => [/Ment/.test(t[0].ask), /in your own words/.test(t[1].ask) && t[1].choices.length > 0, /places people often start/.test(t[2].ask) && t[2].choices.length > 0,
      t.every((x) => x.people.length === 0)] },
  { name: 'choice path: interested in finance -> a specific skill', turns: ["I'm interested in finance", 'a specific skill'],
    check: (t) => [/What in finance/.test(t[0].ask) && t[0].choices.includes('Career advice'), /Which finance skill/.test(t[1].ask)] },
  { name: 'thanks', turns: ['thanks!'], check: (t) => [/welcome|happy to help/i.test(t[0].ask), t[0].people.length === 0] },
  { name: 'department alone: marketing', turns: ['someone in marketing'], check: (t) => [/What in marketing/.test(t[0].ask)] },
  { name: 'vague: I need help', turns: ['I need help'], check: (t) => [/What would you like help with/.test(t[0].ask)] },
  { name: 'department then either works', turns: ['someone in finance', 'either works'],
    check: (t) => [/What in finance/.test(t[0].ask), t[1].people.length > 0 && t[1].people.every(isFinance)] },
  { name: 'absent subject: audit', turns: ['someone in audit'], check: (t) => [!t[0].ask, t[0].people.length > 0, t[0].near, /audit/i.test(t[0].said)] },
  { name: 'out of scope: painter', turns: ['I want to meet a painter'], check: (t) => [!t[0].ask, t[0].people.length === 0] },
  { name: 'specific skill: LBO modelling', turns: ['I need help with LBO modelling'], check: (t) => [!t[0].ask, t[0].people.length > 0, !t[0].near] },
  { name: 'location: senior in London', turns: ['someone senior based in London'],
    check: (t) => [t[0].people.length > 0 && t[0].people.every((p) => p.location === 'London')] },
  { name: 'department + location: finance in Milan', turns: ['someone in finance in Milan'],
    check: (t) => [!t[0].ask, t[0].people.length > 0 && t[0].people.every((p) => p.location === 'Milan' && isFinance(p)), !t[0].near] },
  { name: 'near subject: accounting', turns: ['somebody who works in accounting'], check: (t) => [!t[0].ask, t[0].people.length > 0, !t[0].near || /accounting/i.test(t[0].said)] },
  { name: 'synonym: bookkeeping', turns: ['someone who does bookkeeping'], check: (t) => [!t[0].ask, t[0].people.length > 0, !t[0].near || /bookkeeping/i.test(t[0].said)] },
];

const out = [];
const log = (line = '') => { out.push(line); console.log(line); };
const password = randomBytes(18).toString('base64url');
let passed = 0; let total = 0;
let failed = false;
try {
  // Test the code in this commit, not whatever was deployed before it: wait
  // until the function is newer than the commit, for up to twelve minutes.
  const committedAt = Date.parse(process.env.COMMIT_TIME || '') || 0;
  let fn = {};
  for (let waited = 0; waited <= 720; waited += 30) {
    fn = await mgmt(`/functions/${fnName}`).catch(() => ({}));
    if (!committedAt || (fn.updated_at && fn.updated_at >= committedAt)) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  if (committedAt && !(fn.updated_at >= committedAt)) log('**WARNING: function not redeployed since this commit; results reflect older code.**\n');
  log(`# Discovery live eval (${fnName})\n\ncommit \`${(process.env.GITHUB_SHA || '').slice(0, 7)}\` · function v${fn.version} deployed ${fn.updated_at ? new Date(fn.updated_at).toISOString() : '?'}\n`);
  const keys = await mgmt('/api-keys');
  const anon = keys.find((key) => key.name === 'anon')?.api_key;
  await sql(`update auth.users set encrypted_password = crypt('${password}', gen_salt('bf')),
    confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''),
    email_change = coalesce(email_change, ''), email_change_token_new = coalesce(email_change_token_new, '')
    where id = '${TEST_USER}'`);
  const session = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEST_EMAIL, password }) })).json();
  if (!session.access_token) throw new Error('sign-in failed: ' + JSON.stringify(session).slice(0, 200));

  for (const scenario of SCENARIOS) {
    log(`## ${scenario.name}`);
    let threadId; const turns = [];
    for (const query of scenario.turns) {
      const call = () => fetch(`${base}/functions/v1/${fnName}`, { method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', query, lang: 'en', ...(threadId ? { thread_id: threadId } : {}) }) });
      // Supabase's edge runtime occasionally answers 503 "service degraded";
      // that is the platform, not this code, so try once more before judging.
      let response = await call();
      if (response.status === 503) { await new Promise((resolve) => setTimeout(resolve, 3000)); response = await call(); }
      const d = await response.json().catch(() => ({}));
      threadId = d.thread_id || threadId;
      const turn = { ask: d.clarification || '', said: d.no_match_reason || '', near: Boolean(d.nearest), people: d.matches || [], choices: (d.suggestions || []).map((c) => c.label) };
      turns.push(turn);
      log(`- **you:** ${query}`);
      if (response.status !== 200) log(`  - HTTP ${response.status} ${JSON.stringify(d)}`);
      else if (turn.ask) log(`  - **ment asks:** ${turn.ask}${turn.choices.length ? `\n    - choices: ${turn.choices.join(' · ')}` : ''}`);
      else {
        log(`  - **ment:** ${turn.said || '(exact matches)'}${turn.near ? ' _[closest]_' : ''}${d.model ? ` · model ${d.model}` : ''}`);
        for (const p of turn.people) log(`    - ${p.job_title} · ${p.department} · ${p.location} — ${(p.reasons || [])[0] || ''}`);
      }
    }
    const results = scenario.check(turns);
    const ok = results.every(Boolean);
    total += 1; if (ok) passed += 1;
    log(`- **${ok ? 'PASS' : 'FAIL'}** ${JSON.stringify(results)}\n`);
  }
  log(`**${passed}/${total} scenarios passed**`);
  failed = passed !== total;
} catch (error) {
  log(`\nEVAL ERROR: ${error.message}`);
  failed = true;
} finally {
  try {
    await sql(`update auth.users set encrypted_password = null where id = '${TEST_USER}'`);
    log('\n_test account password cleared_');
  } catch (error) {
    log(`CLEANUP FAILED: ${error.message}`);
    failed = true;
  }
  if (failed) process.exitCode = 1;
}
