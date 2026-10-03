import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryHandler, discoveryFixture, directMatch } from './fixtures/discovery-harness.mjs';

// The lexical lookup and the model check each other. These pin down who has
// the last word in each disagreement, since that is what kept regressing.
const run = await discoveryHandler();
const chat = async (fixture, query) => {
  const response = await run(fixture, { action: 'chat', query, lang: 'en' });
  assert.equal(response.status, 200);
  return response.json();
};
const payload = (fixture, index) => JSON.parse(fixture.calls[index].messages[1].content);

test('a request that names nothing always gets one question, even when the model refuses', async () => {
  const fixture = discoveryFixture({ responses: [{ decision: 'no_match', no_match_reason: 'Nothing here.', named_subject: '' }] });
  const result = await chat(fixture, 'I need help');
  assert.match(result.clarification, /What would you like help with/);
  assert.equal(fixture.calls.length, 1);
});

test('the model cannot veto an exact match', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'finance', named_subject: 'Finance', matching_terms: [] }, directMatch,
  ] });
  const result = await chat(fixture, 'someone in finance');
  assert.equal(result.matches.length, 1);
  assert.equal(result.nearest, false);
});

test('an absent subject goes to its nearest terms, and invented terms are discarded', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'audit', named_subject: 'audit', matching_terms: [], nearest_terms: ['Financial modelling', 'Invented Term'] },
    { outcome: 'no_match', matches: [], no_match_reason: 'Nobody here works in audit.' },
  ] });
  const result = await chat(fixture, 'someone in audit');
  assert.equal(result.clarification, '');
  assert.equal(result.nearest, true);
  assert.equal(result.matches.length, 1, 'the floor answers even when the matcher refuses');
  assert.deepEqual(payload(fixture, 1).nearest_terms, ['Financial modelling']);
  const retrieval = fixture.queries.find((q) => q.name === 'discovery_candidates').args.p_query;
  assert.match(retrieval, /Financial modelling/);
  assert.doesNotMatch(retrieval, /Invented Term/);
});

test('a confirmed synonym steers retrieval without rewriting the request', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'bookkeeping', named_subject: 'bookkeeping', matching_terms: ['Financial modelling'] }, directMatch,
  ] });
  const result = await chat(fixture, 'someone who does bookkeeping');
  assert.equal(result.nearest, false);
  assert.equal(payload(fixture, 1).request, 'bookkeeping');
  assert.deepEqual(payload(fixture, 1).related_terms, ['Financial modelling']);
});

test('a request outside the network stays a clean no-match with no question', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'no_match', search_request: 'painter', named_subject: 'painter', matching_terms: [], nearest_terms: [] },
    { outcome: 'no_match', matches: [], no_match_reason: 'Nobody here paints professionally.' },
  ] });
  const result = await chat(fixture, 'I want to meet a painter');
  assert.equal(result.clarification, '');
  assert.equal(result.no_match, true);
  assert.equal(result.matches.length, 0);
});
