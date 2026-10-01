import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryHandler, discoveryFixture, finance, directMatch } from './fixtures/discovery-harness.mjs';

const run = await discoveryHandler();
const request = async (fixture, body) => {
  const response = await run(fixture, body);
  assert.equal(response.status, 200);
  return response.json();
};

test('website language governs clarification, matching and drafts', async () => {
  for (const [lang, language, greeting] of [['en', 'English', 'Hi'], ['fr', 'French', 'Bonjour'], ['it', 'Italian', 'Ciao']]) {
    const fixture = discoveryFixture({ responses: [
      { decision: 'ready', search_request: 'Financial modelling' }, directMatch, { body: 'Fixture invitation body.' },
    ] });
    await request(fixture, { action: 'chat', query: 'Financial modelling', lang });
    const draft = await request(fixture, { action: 'draft', query: 'Financial modelling', person_id: finance.id, lang });
    for (const call of fixture.calls) assert.match(call.messages[0].content, new RegExp(`in ${language}\\b`));
    assert.ok(draft.draft.startsWith(`${greeting} Finance,`));
    assert.ok(draft.draft.endsWith('Viewer'));
  }
});

test('topic changes reach the model as separate turns and the matcher uses its resolved goal', async () => {
  const turns = [{ role: 'user', content: 'Find a nurse' }, { role: 'assistant', kind: 'clarification', content: 'Which specialty?' }];
  const fixture = discoveryFixture({ turns, responses: [{ decision: 'ready', search_request: 'Financial modelling' }, directMatch] });
  await request(fixture, { action: 'chat', thread_id: 'thread', query: 'Forget that. Financial modelling instead.', lang: 'en' });
  const conversation = JSON.parse(fixture.calls[0].messages[1].content).conversation;
  assert.deepEqual(conversation, [...turns.map(({ role, content }) => ({ role, content })), { role: 'user', content: 'Forget that. Financial modelling instead.' }]);
  assert.equal(JSON.parse(fixture.calls[1].messages[1].content).request, 'Financial modelling');
  assert.match(fixture.calls[0].messages[0].content, /discard the old search criteria/);
  assert.ok(fixture.queries.some(q => q.table === 'discovery_threads' && q.key === 'user_id' && q.value === 'viewer'));
  assert.deepEqual(fixture.thread.turns.slice(-2).map(t => t.role), ['user', 'assistant']);
});

test('a repeated clarification cannot hold the conversation hostage', async () => {
  const fixture = discoveryFixture({ turns: [{ role: 'assistant', kind: 'clarification', content: 'Which finance skill?' }], responses: [
    { decision: 'clarify', question: 'Another question?', search_request: 'Financial modelling' }, directMatch,
  ] });
  const result = await request(fixture, { action: 'chat', thread_id: 'thread', query: 'Any finance skill is fine' });
  assert.equal(result.clarification, '');
  assert.equal(result.matches.length, 1);
  assert.equal(fixture.calls.length, 2);
});

test('matching rejects hallucinated IDs, duplicate IDs, low confidence and invented expertise', async () => {
  const good = directMatch.matches[0];
  const fixture = discoveryFixture({ responses: [{ outcome: 'matches', matches: [
    { ...good, profile_id: 'invented' }, { ...good, confidence: 0.5 },
    { ...good, matched_expertise: ['Medicine'] }, { ...good, reasons: ['No direct experience, but adjacent skills.'] }, good, good,
  ] }] });
  const result = await request(fixture, { query: 'Financial modelling' });
  assert.deepEqual(result.matches.map(m => m.id), [finance.id]);
});

test('string-shaped model arrays are normalized without crashing', async () => {
  const fixture = discoveryFixture({ responses: [{ outcome: 'matches', matches: [{ ...directMatch.matches[0], reasons: 'Teaches financial modelling.', matched_expertise: 'Financial modelling' }] }] });
  const result = await request(fixture, { query: 'Financial modelling' });
  assert.deepEqual(result.matches[0].reasons, ['Teaches financial modelling.']);
});

test('empty candidate pools return a localized honest result without calling the model', async () => {
  for (const [lang, fragment] of [['en', 'no relevant professional'], ['fr', 'aucun professionnel'], ['it', 'professionista pertinente']]) {
    const fixture = discoveryFixture({ candidates: [] });
    const result = await request(fixture, { query: 'Medical professional', lang });
    assert.deepEqual(result.matches, []);
    assert.equal(result.no_match, true);
    assert.ok(result.no_match_reason.includes(fragment));
    assert.equal(fixture.calls.length, 0);
  }
});

test('an unrelated intern is not suggested to an internship seeker', async () => {
  const candidate = { ...finance, job_title: 'Marketing Intern', department: 'Marketing', skills: ['Marketing'] };
  const fixture = discoveryFixture({ candidates: [candidate], responses: [{ outcome: 'matches', matches: [{ ...directMatch.matches[0], matched_expertise: ['Marketing'] }] }] });
  const result = await request(fixture, { query: 'Help finding a finance internship' });
  assert.equal(result.no_match, true);
  assert.deepEqual(result.matches, []);
});

test('rate limiting blocks provider calls and persistence', async () => {
  const fixture = discoveryFixture();
  fixture.rateLimited = true;
  const response = await run(fixture, { action: 'chat', query: 'finance' });
  assert.equal(response.status, 429);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.thread, null);
});
