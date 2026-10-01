import assert from 'node:assert/strict';
import { discoveryHandler, discoveryFixture } from './fixtures/discovery-harness.mjs';

// Opt-in, bounded provider evaluation. All profiles/conversations are synthetic.
if (!(process.env.MISTRAL_API || process.env.MISTRAL_API_KEY) || !process.env.MISTRAL_MODEL) {
  throw new Error('Live evaluation requires MISTRAL_API (or MISTRAL_API_KEY) and MISTRAL_MODEL. No calls were made.');
}
const run = await discoveryHandler();
const cases = [
  { name: 'broad field asks one short question', body: { query: 'finance', lang: 'en' }, check: result => assert.ok(result.clarification && result.clarification.split(/\s+/).length <= 20) },
  { name: 'French clarification', body: { query: 'finance', lang: 'fr' }, check: result => assert.match(result.clarification, /vous|quel|souhait|cherch|besoin|voulez|pr[eé]f[eé]r/i) },
  { name: 'Italian clarification', body: { query: 'finance', lang: 'it' }, check: result => assert.match(result.clarification, /vuoi|quale|cerchi|prefer|ti |vorre|interess|hai /i) },
  { name: 'specific skill needs no clarification', body: { query: 'Financial modelling', lang: 'en' }, check: result => { assert.equal(result.clarification, ''); assert.equal(result.matches[0]?.id, 'finance'); } },
  { name: 'goal replacement drops medicine', turns: [{ role: 'user', content: 'Find a nurse' }, { role: 'assistant', kind: 'clarification', content: 'Which specialty?' }], body: { query: 'Forget medicine. Help with financial modelling instead.', lang: 'en', thread_id: 'thread' }, check: result => { assert.doesNotMatch(result.resolved_request, /nurse|medic|health|clinic/i); assert.equal(result.matches[0]?.id, 'finance'); } },
  { name: 'no repeated clarification', turns: [{ role: 'user', content: 'finance' }, { role: 'assistant', kind: 'clarification', content: 'Which finance skill?' }], body: { query: 'Any finance skill is fine', thread_id: 'thread', lang: 'en' }, check: result => { assert.equal(result.clarification, ''); assert.equal(result.matches[0]?.id, 'finance'); } },
  { name: 'no adjacent medical match', body: { query: 'Find a nurse with clinical experience', lang: 'en' }, check: result => { assert.equal(result.no_match, true); assert.deepEqual(result.matches, []); assert.equal(result.clarification, ''); } },
];
let failures = 0;
for (const scenario of cases) {
  const fixture = discoveryFixture({ live: true, turns: scenario.turns });
  try {
    const response = await run(fixture, { action: 'chat', ...scenario.body });
    assert.equal(response.status, 200, 'Provider request must succeed');
    const result = await response.json();
    scenario.check(result);
    console.log(`PASS: ${scenario.name} (${fixture.calls.length} provider calls)`);
  } catch {
    failures += 1;
    console.error(`FAIL: ${scenario.name}`);
  }
}
console.log(`${cases.length - failures}/${cases.length} live AI evaluations passed`);
process.exitCode = failures ? 1 : 0;
