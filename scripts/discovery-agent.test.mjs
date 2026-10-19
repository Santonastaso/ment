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

test('no name or profile id reaches the model while matching or drafting', async () => {
  const maria = { ...finance, id: 'maria-id', name: 'Maria Rossi' };
  const fixture = discoveryFixture({ candidates: [maria], responses: [
    { decision: 'ready', search_request: 'Financial modelling' },
    { outcome: 'matches', matches: [{ ...directMatch.matches[0], profile_id: maria.id }] },
    { body: 'I would value your view on financial modelling.' },
  ] });
  const result = await request(fixture, { action: 'chat', query: 'Financial modelling', lang: 'en' });
  assert.deepEqual(result.matches.map((m) => [m.id, m.name]), [['maria-id', 'Maria Rossi']], 'the stand-in maps back to the person');
  const draft = await request(fixture, { action: 'draft', query: 'Financial modelling', person_id: maria.id, lang: 'en' });
  assert.ok(draft.draft.startsWith('Hi Maria,') && draft.draft.endsWith('Viewer'), 'names are added in code');
  for (const call of fixture.calls) {
    const sent = JSON.stringify(call.messages);
    for (const secret of ['Maria', 'Rossi', 'maria-id', 'Viewer']) assert.ok(!sent.includes(secret), `${secret} was sent`);
  }
});

test('the rewording pass sees a stand-in for the person it names, and the name comes back', async () => {
  const maria = { ...finance, id: 'maria-id', name: 'Maria Rossi' };
  // The opening line is chosen at random and only some name the person, so
  // ask until one does; every attempt must keep the name from the model.
  let named = false;
  for (let attempt = 0; attempt < 30 && !named; attempt += 1) {
    const fixture = discoveryFixture({ voice: true, candidates: [maria], responses: [
      { decision: 'ready', search_request: 'Financial modelling' },
      { outcome: 'matches', matches: [{ ...directMatch.matches[0], profile_id: maria.id }] },
      (sent) => ({ text: JSON.parse(sent.messages[1].content).message }),
    ] });
    const result = await request(fixture, { action: 'chat', query: 'Financial modelling', lang: 'en' });
    const voice = fixture.calls.at(-1);
    assert.ok(!JSON.stringify(voice.messages).includes('Maria'), 'the name is masked');
    const masked = JSON.parse(voice.messages[1].content).message;
    named = masked.includes('PERSON_1');
    const shown = result.message ?? result.reply ?? result.content;
    assert.equal(shown, masked.replaceAll('PERSON_1', 'Maria'));
  }
  assert.ok(named, 'some reply named the person');
});
