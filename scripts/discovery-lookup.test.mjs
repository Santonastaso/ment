import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryHandler, discoveryFixture, directMatch, finance } from './fixtures/discovery-harness.mjs';

const hr = { id: 'hr', name: 'HR Person', job_title: 'Talent Manager', department: 'Human Resources', program: 'MBA', skills: ['talent acquisition'], location: 'Paris' };

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
    { decision: 'ready', search_request: 'Financial modelling', named_subject: 'Financial modelling', matching_terms: [] }, directMatch,
  ] });
  const result = await chat(fixture, 'help with Financial modelling');
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

test('a synonym only the model proposes finds people but is labelled closest', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'bookkeeping', named_subject: 'bookkeeping', matching_terms: ['Financial modelling'] }, directMatch,
  ] });
  const result = await chat(fixture, 'someone who does bookkeeping');
  assert.equal(result.matches.length, 1);
  assert.equal(result.nearest, true, 'only the user\'s own words can make a result exact');
  assert.equal(payload(fixture, 1).request, 'bookkeeping');
  assert.deepEqual(payload(fixture, 1).nearest_terms, ['Financial modelling']);
});

test('a department and a place alone are answered from the filters even if the matcher declines', async () => {
  const milan = { ...finance, id: 'milan', location: 'Milan' };
  const fixture = discoveryFixture({ candidates: [finance, milan, hr], responses: [
    { decision: 'ready', search_request: 'career change help in finance', named_subject: 'finance', named_location: 'Milan' },
    { outcome: 'no_match', matches: [], no_match_reason: 'Nobody here helps with career changes.' },
  ] });
  // Production coverage lists locations; the shared harness does not.
  const rpc = fixture.sb.rpc;
  fixture.sb.rpc = async (name, args) => {
    const result = await rpc(name, args);
    if (name === 'discovery_network_coverage') result.data.locations = ['Milan', 'Paris'];
    return result;
  };
  const result = await chat(fixture, 'someone in finance in Milan');
  assert.deepEqual(result.matches.map((m) => m.id), ['milan']);
  assert.equal(result.nearest, false);
  assert.doesNotMatch(payload(fixture, 1).request, /career change/);
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

test('a refused default model falls back to the configured one instead of failing', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'Financial modelling', named_subject: 'Financial modelling' }, directMatch,
  ] });
  const served = fixture.fetch.bind(fixture);
  const tried = [];
  fixture.fetch = async (url, options) => {
    const { model } = JSON.parse(options.body);
    tried.push(model);
    if (model === 'mistral-small-latest') return new Response('{"message":"quota"}', { status: 429 });
    return served(url, options);
  };
  const result = await chat(fixture, 'help with Financial modelling');
  assert.equal(result.matches.length, 1);
  assert.ok(tried.includes('mistral-small-latest'), 'the preferred model is tried first');
  assert.ok(tried.includes('fixture-model'), 'then the configured model answers');
});

test('a vague request is asked a question even when the model invents a subject', async () => {
  const fixture = discoveryFixture({ responses: [{ decision: 'no_match', named_subject: 'help', matching_terms: [], nearest_terms: [] }] });
  const result = await chat(fixture, 'I need help');
  assert.match(result.clarification, /What would you like help with/);
});

test('a department on its own is asked a question even when the model would search', async () => {
  const fixture = discoveryFixture({ responses: [{ decision: 'ready', search_request: 'finance', named_subject: 'finance', matching_terms: ['Finance'] }] });
  const result = await chat(fixture, 'someone in finance');
  assert.match(result.clarification, /What in finance would help most/);
  assert.equal(fixture.calls.length, 1);
});

test('after the answer, results must carry the subject: no HR people for finance', async () => {
  const turns = [{ role: 'user', content: 'someone in finance' }, { role: 'assistant', kind: 'clarification', content: 'What in finance would help most?' }];
  const hrMatch = { profile_id: hr.id, confidence: 0.9, reasons: ['Hires finance professionals.'], matched_expertise: ['talent acquisition'] };
  const fixture = discoveryFixture({ candidates: [finance, hr], turns, responses: [
    { decision: 'ready', search_request: 'finance', named_subject: 'finance', matching_terms: ['Finance'] },
    { outcome: 'matches', matches: [hrMatch, directMatch.matches[0]] },
  ] });
  const response = await run(fixture, { action: 'chat', thread_id: 'thread', query: 'either works', lang: 'en' });
  const result = await response.json();
  assert.deepEqual(result.matches.map((m) => m.id), [finance.id]);
  assert.deepEqual(payload(fixture, 1).candidates.map((c) => c.id), [finance.id], 'HR is never even offered to the matcher');
});

// The funnel, walked turn by turn: support -> industry -> finance -> answer.
const say = async (fixture, query, threadId) => (await run(fixture, { action: 'chat', query, lang: 'en', ...(threadId ? { thread_id: threadId } : {}) })).json();
const clarify = (extra = {}) => ({ decision: 'ready', search_request: '', named_subject: '', ...extra });

test('the funnel goes one level down per answer that narrows nothing', async () => {
  const fixture = discoveryFixture({ candidates: [finance, hr], responses: [clarify(), clarify(), clarify({ named_subject: 'finance' })] });
  const first = await say(fixture, 'I am looking for support');
  assert.match(first.clarification, /What would you like help with/);
  const second = await say(fixture, 'industry', first.thread_id);
  assert.match(second.clarification, /Which field are you thinking of/);
  const third = await say(fixture, 'finance', first.thread_id);
  assert.match(third.clarification, /What in finance would help most/);
  assert.equal(fixture.thread.turns.at(-1).department, 'Finance');
});

test('an answer inside a chosen department stays inside it', async () => {
  const turns = [{ role: 'user', content: 'finance' }, { role: 'assistant', kind: 'clarification', content: 'What in finance would help most?', stage: 'department', department: 'Finance' }];
  const hrMatch = { profile_id: hr.id, confidence: 0.9, reasons: ['Coaches careers.'], matched_expertise: ['talent acquisition'] };
  const fixture = discoveryFixture({ candidates: [finance, hr], turns, responses: [
    clarify({ search_request: 'career advice', named_subject: 'career advice', matching_terms: [] }),
    { outcome: 'matches', matches: [hrMatch, directMatch.matches[0]] },
  ] });
  const result = await say(fixture, 'career advice', 'thread');
  assert.deepEqual(result.matches.map((m) => m.id), [finance.id]);
  assert.match(payload(fixture, 1).request, /Finance/);
});

test('a category answer inside a department asks for the specific thing', async () => {
  const turns = [{ role: 'user', content: 'finance' }, { role: 'assistant', kind: 'clarification', content: 'What in finance would help most?', stage: 'department', department: 'Finance' }];
  const fixture = discoveryFixture({ candidates: [finance, hr], turns, responses: [clarify()] });
  const result = await say(fixture, 'a specific skill', 'thread');
  assert.equal(result.clarification, 'Which finance skill would you like help with?');
});

test('after three questions a reply naming nothing is still guided, and a named field searches', async () => {
  const q = (content) => ({ role: 'assistant', kind: 'clarification', content, stage: 'open' });
  const turns = [{ role: 'user', content: 'help' }, q('1?'), { role: 'user', content: 'hmm' }, q('2?'), { role: 'user', content: 'not sure' }, q('3?')];
  const vague = discoveryFixture({ turns, responses: [clarify()] });
  const guided = await say(vague, 'anything', 'thread');
  assert.ok(guided.clarification && guided.suggestions.length > 0, 'searching on nothing would return noise');
  const named = discoveryFixture({ turns, responses: [clarify({ named_subject: 'Financial modelling' }), directMatch] });
  const searched = await say(named, 'Financial modelling', 'thread');
  assert.equal(searched.clarification, '');
  assert.equal(searched.matches.length, 1);
});

test('a department the model mislabels as a location still gets the department question', async () => {
  const turns = [{ role: 'user', content: 'industry' }, { role: 'assistant', kind: 'clarification', content: 'Which field?', stage: 'field', department: '' }];
  const fixture = discoveryFixture({ candidates: [finance, hr], turns, responses: [clarify({ named_subject: 'finance', named_location: 'finance' })] });
  const result = await say(fixture, 'finance', 'thread');
  assert.match(result.clarification, /What in finance would help most/);
});

// The sentences around the results: sized to the count, warm, and specific.
test('a single exact match is never asked to "pick one"', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'Financial modelling', named_subject: 'Financial modelling', matching_terms: [] }, directMatch,
  ] });
  const result = await chat(fixture, 'help with Financial modelling');
  assert.equal(result.matches.length, 1);
  assert.doesNotMatch(result.message, /pick/i);
  assert.match(result.message, /someone/i);
  assert.equal(fixture.thread.turns.at(-1).framed, true);
});

test('a close match names what is missing and what is close, in the singular', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'ready', search_request: 'audit', named_subject: 'audit', matching_terms: [], nearest_terms: ['Financial modelling'] },
    { outcome: 'no_match', matches: [] },
  ] });
  const result = await chat(fixture, 'someone in audit');
  assert.match(result.message, /^I couldn't find anyone working in audit here, but this person has a background in financial modelling/);
});

test('a no-match invites a more specific request instead of stopping', async () => {
  const fixture = discoveryFixture({ responses: [
    { decision: 'no_match', search_request: 'painter', named_subject: 'painter', matching_terms: [], nearest_terms: [] },
    { outcome: 'no_match', matches: [] },
  ] });
  const result = await chat(fixture, 'I want to meet a painter');
  assert.match(result.no_match_reason, /^I couldn't find anyone working as a painter here/);
  assert.match(result.no_match_reason, /industry|role|job title|skill/);
});

// The CTO's three cases: small talk, slang around a department, and reacting
// to the results instead of searching the words of the reaction.
test('"who are you" gets an introduction, not a search', async () => {
  const fixture = discoveryFixture({ responses: [clarify({ intent: 'greeting' })] });
  const result = await chat(fixture, 'Hi who are you?');
  assert.match(result.clarification, /I'm Ment/);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.thread.turns.at(-1).kind, 'chat');
});

test('a greeting that names a field is still a search', async () => {
  const fixture = discoveryFixture({ responses: [clarify({ intent: 'greeting', named_subject: 'finance' })] });
  const result = await chat(fixture, 'hi, someone in finance');
  assert.match(result.clarification, /What in finance would help most/);
});

test('slang around a department still gets the scoping question', async () => {
  const fixture = discoveryFixture({ responses: [clarify({ named_subject: 'finance' })] });
  const result = await chat(fixture, 'nevermind, im looking for someone in finance bro');
  assert.match(result.clarification, /What in finance would help most/);
});

const shownTurns = (department = 'Finance') => [
  { role: 'user', content: 'someone in finance' },
  { role: 'assistant', kind: 'matches', framed: true, content: 'I found someone.', search_request: 'Finance', department, location: '',
    matches: [{ id: finance.id, name: finance.name }] },
];

test('"ask me questions" after results starts scoping instead of searching', async () => {
  const fixture = discoveryFixture({ candidates: [finance, hr], turns: shownTurns(), responses: [clarify({ intent: 'ask_me' })] });
  const result = await say(fixture, 'no but i want more options, ask me clarifying questions', 'thread');
  assert.match(result.clarification, /What in finance would help most/);
});

test('"more options" excludes people already shown and keeps the scope', async () => {
  const second = { ...finance, id: 'finance2', name: 'Second Finance' };
  const fixture = discoveryFixture({ candidates: [finance, second, hr], turns: shownTurns(), responses: [
    clarify({ intent: 'more' }),
    { outcome: 'matches', matches: [{ profile_id: second.id, confidence: 0.9, reasons: ['Also in finance.'], matched_expertise: ['Financial modelling'] }] },
  ] });
  const result = await say(fixture, 'show me more options', 'thread');
  assert.deepEqual(payload(fixture, 1).candidates.map((c) => c.id), [second.id], 'shown people and HR are excluded');
  assert.match(result.message, /one more person/);
});

test('when nobody else fits, "more" says so and offers to widen', async () => {
  const fixture = discoveryFixture({ candidates: [finance, hr], turns: shownTurns(), responses: [clarify({ intent: 'more' })] });
  const result = await say(fixture, 'more please', 'thread');
  assert.match(result.no_match_reason, /everyone who fits/);
});

// Guided choices: asking for proposals is vague, and vague keeps being guided.
test('asking for proposals is guided with choices, not searched', async () => {
  const fixture = discoveryFixture({ candidates: [finance, hr], responses: [clarify({ named_subject: 'propose some people' })] });
  const result = await chat(fixture, 'can you propose some people to me?');
  assert.match(result.clarification, /What would you like help with/);
  assert.match(result.clarification, /in your own words/);
  assert.deepEqual(result.suggestions.map((c) => c.label), ['Finance', 'Human Resources']);
  assert.equal(result.suggestions[0].message, "I'm interested in finance");
  assert.equal(fixture.calls.length, 1, 'no search was run');
});

test('a second vague request keeps guiding, past the question cap', async () => {
  const q = (content) => ({ role: 'assistant', kind: 'clarification', content, stage: 'open' });
  const turns = [{ role: 'user', content: 'help' }, q('1?'), { role: 'user', content: 'hmm' }, q('2?'), { role: 'user', content: 'not sure' }, q('3?')];
  const fixture = discoveryFixture({ candidates: [finance, hr], turns, responses: [clarify()] });
  const result = await say(fixture, 'I would like you to propose some people to me', 'thread');
  assert.match(result.clarification, /here are a few places people often start/);
  assert.ok(result.suggestions.length > 0);
});

test('a chosen department offers how to narrow it', async () => {
  const fixture = discoveryFixture({ candidates: [finance, hr], responses: [clarify({ named_subject: 'finance' })] });
  const result = await chat(fixture, "I'm interested in finance");
  assert.match(result.clarification, /What in finance would help most/);
  assert.deepEqual(result.suggestions.map((c) => c.label), ['A specific skill', 'A type of role', 'Career advice']);
});

test('the greeting offers the same starting choices', async () => {
  const fixture = discoveryFixture({ candidates: [finance, hr], responses: [clarify()] });
  const result = await chat(fixture, 'hi how are you?');
  assert.match(result.clarification, /I'm Ment/);
  assert.ok(result.suggestions.some((c) => c.label === 'Finance'));
});

test('a category answer in Italian or French asks "which one" instead of searching', async () => {
  const turns = [{ role: 'user', content: 'Mi interessa marketing' }, { role: 'assistant', kind: 'clarification', content: 'Cosa ti servirebbe di piu in marketing?', stage: 'department', department: 'Marketing' }];
  const marketing = { ...finance, id: 'mkt', department: 'Marketing', job_title: 'SEO & Content Lead', skills: ['content strategy'] };
  for (const [lang, reply, expected] of [['it', 'una competenza precisa', /Con quale competenza in marketing/], ['fr', 'une compétence précise', /Sur quelle competence en marketing/]]) {
    const fixture = discoveryFixture({ candidates: [marketing], turns, responses: [clarify()] });
    const result = await (await run(fixture, { action: 'chat', thread_id: 'thread', query: reply, lang })).json();
    assert.match(result.clarification, expected);
    assert.equal(fixture.calls.length, 1, 'no search was run');
  }
});

test('a skill named alongside the category is searched, not asked again', async () => {
  const turns = [{ role: 'user', content: 'finance' }, { role: 'assistant', kind: 'clarification', content: 'What in finance?', stage: 'department', department: 'Finance' }];
  const fixture = discoveryFixture({ turns, responses: [clarify({ named_subject: 'Financial modelling' }), directMatch] });
  const result = await say(fixture, 'a specific skill: financial modelling', 'thread');
  assert.equal(result.clarification, '');
  assert.equal(result.matches.length, 1);
});

test('a follow-up nobody meets keeps the earlier people as the closest answer', async () => {
  const turns = [
    { role: 'user', content: 'I am looking for someone working as consultant' },
    { role: 'assistant', kind: 'matches', framed: true, content: 'These people look like a great fit.', search_request: 'consultant', department: '', location: '',
      matches: [{ id: finance.id, name: finance.name, job_title: finance.job_title }] },
  ];
  const fixture = discoveryFixture({ turns, responses: [
    clarify({ named_subject: '5 years of experience' }),
    { outcome: 'no_match', matches: [], no_match_reason: 'Nobody has that.' },
  ] });
  const result = await say(fixture, 'is there someone with more than 5 years of experience?', 'thread');
  assert.match(result.message, /^Nobody here matches that extra requirement/);
  assert.deepEqual(result.matches.map((m) => m.id), [finance.id]);
  assert.match(payload(fixture, 1).request, /^consultant; /, 'the follow-up refines the earlier search');
});
