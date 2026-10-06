// Runs synthetic scenarios against staging and reports aggregate pass/fail only.
import { randomBytes } from 'node:crypto';

const ref = process.env.SUPABASE_EVAL_PROJECT_REF;
const pat = process.env.SUPABASE_EVAL_ACCESS_TOKEN;
const productionRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF;
const TEST_USER = process.env.SUPABASE_EVAL_TEST_USER;
const TEST_EMAIL = process.env.SUPABASE_EVAL_TEST_EMAIL;
if (!ref || !pat || !productionRef || !TEST_USER || !TEST_EMAIL) throw new Error('Missing staging eval configuration');
if (ref.toLowerCase() === productionRef.toLowerCase()) throw new Error('Live eval must not target production');
if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(TEST_USER)
  || !/^[a-z0-9._%+-]+@dummy\.ment\.io$/i.test(TEST_EMAIL)) {
  throw new Error('Live eval requires its dedicated dummy test account');
}
if (!/^[a-z0-9]{20}$/i.test(ref) || !/^[a-z0-9]{20}$/i.test(productionRef)) {
  throw new Error('Invalid Supabase project reference');
}
const api = `https://api.supabase.com/v1/projects/${ref}`;
const base = `https://${ref}.supabase.co`;
const fnName = process.env.DISCOVERY_FUNCTION || 'discovery-assistant';

const mgmt = async (path, init = {}) => {
  const response = await fetch(api + path, { ...init, headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
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
    check: (t) => [Boolean(t[0].ask) && t[0].choices.length > 0, /in your own words/.test(t[1].ask) && t[1].choices.length > 0, /places people often start/.test(t[2].ask) && t[2].choices.length > 0,
      t.every((x) => x.people.length === 0)] },
  { name: 'choice path: interested in finance -> a specific skill', turns: ["I'm interested in finance", 'a specific skill'],
    check: (t) => [/What in finance/.test(t[0].ask) && t[0].choices.includes('Career advice'), /Which finance skill/.test(t[1].ask)] },
  { name: 'Italian: marketing -> una competenza precisa', lang: 'it', turns: ['Mi interessa marketing', 'una competenza precisa'],
    check: (t) => [/marketing/.test(t[0].ask) && t[0].choices.length > 0, /Con quale competenza in marketing/.test(t[1].ask), t[1].people.length === 0] },
  { name: 'French: finance -> une compétence précise', lang: 'fr', turns: ["Je m'intéresse à finance", 'une compétence précise'],
    check: (t) => [/finance/.test(t[0].ask), /Sur quelle competence en finance/.test(t[1].ask), t[1].people.length === 0] },
  { name: 'follow-up about the people shown', turns: ['I am looking for someone working as consultant', 'is there someone with more than 5 years of experience?'],
    check: (t) => [t[0].people.length > 0, t[1].people.length > 0, !/working in years/i.test(t[1].said)] },
  { name: 'small talk', turns: ['how are you doing?'],
    check: (t) => [Boolean(t[0].ask) && !/What would you like help with/.test(t[0].ask), t[0].choices.length > 0, t[0].people.length === 0,
      /someone new|new skill/.test(t[0].ask), !/coffee|weather|sunny/i.test(t[0].ask)] },
  { name: 'IB, then experience, then Europe', turns: ['looking for something in investment banking', 'I would like someone with 3+ years of experience', 'what about someone working in IB in Europe?'],
    check: (t) => {
      const europe = ['Amsterdam', 'Berlin', 'Brussels', 'Cergy', 'Dublin', 'Frankfurt', 'Geneva', 'Lisbon', 'London', 'Madrid', 'Milan', 'Munich', 'Paris', 'Zurich'];
      return [t[0].people.length > 0, t[2].people.length > 0,
        t[2].people.every((p) => europe.includes(p.location)) || /^Nobody here matches that extra requirement/.test(t[2].said),
        !/industry, a job title/.test(t[2].said)];
    } },
  { name: 'co-founder: strategy, then construction, real estate, law',
    turns: ["I'm looking for someone working in Strategy?", 'strategic consulting, to be precise', 'What about somebody in construction instead?',
      'none of these have anything to do with construction', 'yes, try the angle of real estate', 'anything related to law?'],
    check: (t) => {
      const notStrategyOnly = (x) => x.people.length === 0 || !x.people.every((p) => p.department === 'Strategy');
      const gap = (x) => x.said.split(' — ')[0];
      return [/What in strategy/.test(t[0].ask), t[1].people.length > 0,
        notStrategyOnly(t[2]) && /construction/i.test(t[2].said),
        /construction/i.test(t[3].said) || t[3].people.every((p) => !t[2].people.some((q) => q.id === p.id)),
        notStrategyOnly(t[4]) && /real estate/i.test(gap(t[4])),
        notStrategyOnly(t[5]) && /\blaw\b/i.test(gap(t[5]))];
    } },
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
let sent = [];
let failed = false;
let passwordWasSet = false;
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
  await sql(`do $eval$
    declare updated integer;
    begin
      update auth.users set encrypted_password = crypt('${password}', gen_salt('bf')),
        confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''),
        email_change = coalesce(email_change, ''), email_change_token_new = coalesce(email_change_token_new, '')
        where id = '${TEST_USER}' and lower(email) = lower('${TEST_EMAIL}');
      get diagnostics updated = row_count;
      if updated <> 1 then raise exception 'evaluation_fixture_mismatch'; end if;
    end;
  $eval$`);
  passwordWasSet = true;
  const session = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEST_EMAIL, password }) })).json();
  if (!session.access_token) throw new Error('staging test account sign-in failed');

  for (const scenario of SCENARIOS) {
    log(`## ${scenario.name}`);
    let threadId; const turns = [];
    for (const query of scenario.turns) {
      const call = () => fetch(`${base}/functions/v1/${fnName}`, { method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', query, lang: scenario.lang || 'en', ...(threadId ? { thread_id: threadId } : {}) }) });
      // Supabase's edge runtime occasionally answers 503 "service degraded";
      // that is the platform, not this code, so try once more before judging.
      // The function allows 30 chat messages per user per five minutes; the
      // suite is longer than that, so pace it to stay inside the limit.
      sent = sent.filter((at) => Date.now() - at < 300_000);
      if (sent.length >= 26) await new Promise((resolve) => setTimeout(resolve, 300_000 - (Date.now() - sent[0]) + 1000));
      sent.push(Date.now());
      let response = await call();
      if (response.status === 503) { await new Promise((resolve) => setTimeout(resolve, 3000)); response = await call(); }
      // Back-to-back runs share the per-user rate-limit window; wait it out
      // rather than recording the limiter as a product failure.
      for (let attempt = 0; response.status === 429 && attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        response = await call();
      }
      const d = await response.json().catch(() => ({}));
      threadId = d.thread_id || threadId;
      const turn = { ask: d.clarification || '', said: d.no_match_reason || d.message || '', near: Boolean(d.nearest), people: d.matches || [], choices: (d.suggestions || []).map((c) => c.label) };
      turns.push(turn);
      log(`- **you:** ${query}`);
      if (response.status !== 200) log(`  - HTTP ${response.status}`);
      else if (turn.ask) log('  - clarification returned');
      else log(`  - ${turn.people.length} matches returned`);
    }
    const results = scenario.check(turns);
    const ok = results.every(Boolean);
    total += 1; if (ok) passed += 1;
    log(`- **${ok ? 'PASS' : 'FAIL'}** ${JSON.stringify(results)}\n`);
  }
  log(`**${passed}/${total} scenarios passed**`);
  failed = passed !== total;
} catch (error) {
  log(`\nEVAL ERROR: ${error instanceof Error ? error.message : 'unknown error'}`);
  failed = true;
} finally {
  if (passwordWasSet) {
    try {
      await sql(`update auth.users set encrypted_password = null where id = '${TEST_USER}'`);
      log('\n_test account password cleared_');
    } catch {
      log('CLEANUP FAILED: test account password could not be cleared');
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}
