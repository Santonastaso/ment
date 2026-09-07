// Pure provider interface: no model calls, invented profiles, or profile writes.
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
      const evidence = attributes.filter(a => terms.some(term => contains(normalize(a), term)));
      return { person, evidence };
    })
    .filter(result => result.evidence.length)
    .sort((a, b) => String(a.person.id).localeCompare(String(b.person.id)))
    .slice(0, 3);
}
export async function loadDirectory(api) {
  const people = [];
  for (let offset = 0; ; offset += 50) {
    const { data } = await api.get(`/directory?limit=50&offset=${offset}`);
    if (!Array.isArray(data?.people)) throw new Error('Invalid directory response');
    people.push(...data.people);
    if (data.people.length < 50 || people.length >= data.total) return people;
  }
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
