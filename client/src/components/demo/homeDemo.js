// Pure provider interface: no model calls or profile writes.
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const scenarios = {
  internship: ['internship', 'intern', 'placement', 'stage', 'tirocinio'],
  career: ['career switch', 'career change', 'change careers', 'cambiare lavoro', 'cambio carriera', 'reconversion', 'changer de metier'],
  technical: ['technical', 'coding', 'code', 'debug', 'python', 'javascript', 'react', 'sql', 'programmazione', 'tecnico', 'technique'],
  mentorship: ['mentor', 'mentorship', 'mentoring', 'mentore', 'mentorat', 'accompagnement'],
};
const topics = {
  internship: ['intern', 'stage', 'tirocinio', 'recruit', 'recrut', 'career', 'carriera', 'carriere', 'cv', 'interview', 'colloquio'],
  career: ['career', 'carriera', 'carriere', 'reconversion', 'recruit', 'coaching'],
  technical: ['python', 'javascript', 'react', 'sql', 'software', 'coding', 'programmazione', 'informatique', 'data'],
  mentorship: ['mentor', 'leadership', 'coaching'],
};
const contains = (text, term) => new RegExp(`(^|[^a-z0-9])${term}([a-z]*)(?=$|[^a-z0-9])`).test(text);
export function classifyNeed(text) {
  const normalized = normalize(text);
  return Object.keys(scenarios).find(key => scenarios[key].some(term => contains(normalized, term))) || null;
}
export function detectIntent(text, previous = 'one_off') {
  const value = normalize(text);
  if (/one.off|single|una volta|singolo|ponctuel|unique/.test(value)) return 'one_off';
  return /ongoing|regular|long.term|mentor|continuativ|regolar|suivi|durable/.test(value) ? 'ongoing' : previous;
}
export function suggestPeople({ question, scenario, people, userId }) {
  const specific = topics.technical.filter(term => contains(normalize(question), term));
  const terms = scenario === 'technical' && specific.length ? specific : topics[scenario] || [];
  return [...new Map(people.map(person => [person.id, person])).values()]
    .filter(p => p.id !== userId && p.mentorship_available === true && p.request_eligible !== false && p.remaining_capacity !== 0)
    .filter(p => scenario !== 'mentorship' || p.role === 'alumnus')
    .map(person => {
      const attributes = [...(person.skills || []).filter(s => s.type === 'can_teach').map(s => s.skill), person.job_title, person.program].filter(Boolean);
      const directEvidence = attributes.filter(a => terms.some(term => contains(normalize(a), term)));
      const rankedEvidence = (person.match_reasons || []).slice(0, 2);
      const evidence = [...new Set([...directEvidence, ...rankedEvidence])];
      return { person, evidence, relevance: directEvidence.length * 100 + Number(person.match_score || 0) };
    })
    .filter(result => result.evidence.length)
    .sort((a, b) => b.relevance - a.relevance || String(a.person.id).localeCompare(String(b.person.id)))
    .slice(0, 3);
}
// The chat presents Ment's existing ranked matches conversationally.
export async function loadConversationCandidates(api) {
  const { data } = await api.get('/matches?role=mentor&limit=50&includeDirectory=1');
  return (data?.matches || []).map((match) => ({
    ...match.user,
    match_score: match.score || 0,
    match_reasons: match.reasons || [],
    // `role=mentor` enforces current availability in the security-definer RPC.
    mentorship_available: true,
    request_eligible: true,
  }));
}

export function getDiscoveryMatches({ query, people, userId }) {
  const scenario = classifyNeed(query);
  const suggested = scenario ? suggestPeople({ question: query, scenario, people, userId }) : [];
  const ranked = suggested.length
    ? suggested
    : people
      .filter(person => person.id !== userId && person.mentorship_available !== false && person.request_eligible !== false)
      .sort((a, b) => Number(b.match_score || 0) - Number(a.match_score || 0))
      .slice(0, 3)
      .map(person => ({ person, evidence: person.match_reasons || [] }));
  return ranked.slice(0, 3).map(({ person, evidence }) => ({
    person,
    reason: evidence[0] || `${person.name?.split(' ')[0] || 'They'} can share relevant experience from ${person.job_title || person.department || 'their work'}.`,
  }));
}

export function createDiscoveryDraft({ userName, person, query, reason, variant = 0 }) {
  const from = userName?.split(' ')[0] || 'there';
  const to = person.name?.split(' ')[0] || 'there';
  const context = variant === 0
    ? `I am looking for help with ${query.trim()}. I saw that ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`
    : `I am working on ${query.trim()} and your background stood out to me: ${reason}`;
  return `Hi ${to},\n\nI'm ${from}. ${context}\n\nWould you be open to a short conversation in the next couple of weeks? Happy to work around your schedule.\n\nThanks so much,\n${from}`;
}
export function discoveryReply({ question, previousQuestion = '', people = [], userId, intent = 'one_off' }) {
  const combined = [previousQuestion, question].filter(Boolean).join('\n');
  const scenario = classifyNeed(question) || classifyNeed(previousQuestion);
  const nextIntent = detectIntent(question, intent);
  if (!scenario) return { kind: 'clarify', intent: nextIntent, suggestions: [] };
  const suggestions = suggestPeople({ question: combined, scenario, people, userId });
  return { kind: suggestions.length ? 'results' : 'empty', scenario, intent: nextIntent, suggestions };
}
export function createDraft({ name, question, intent, when, copy }) {
  return `${copy.hello} ${name},\n\n${question.trim()}\n\n${intent === 'ongoing' ? copy.ongoingDraft : copy.oneOffDraft}\n${when ? `${copy.proposedTime}: ${when}` : copy.flexibleDraft}`;
}
