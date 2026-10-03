// Everything Ment says around the results. These are templates rather than
// model prose: the sentences set the tone and say what happens next, and the
// small model wrote them like compliance notices. Specifics come from real
// data -- what the user asked for, how many people came back, and which terms
// in the network are close -- so the wording stays specific without being
// improvised. Two phrasings per situation keep it from sounding canned.

export type Gap = {
  // subject: the thing asked for is not here; place: the city is not here;
  // busy: the city is here but nobody there is free; none: no exact match.
  kind: 'subject' | 'place' | 'busy' | 'none';
  value: string;
  // "a painter" (a role) reads differently from "audit" (a field).
  role: boolean;
};

export const NO_GAP: Gap = { kind: 'none', value: '', role: false };

type Copy = {
  exactMany: string[];
  exactOne: string[];
  missing: (gap: Gap) => string;
  closeMany: (terms: string) => string;
  closeOne: (terms: string) => string;
  actMany: string[];
  actOne: string[];
  retry: (strengths: string) => string[];
  join: string;
};

const COPY: Record<string, Copy> = {
  English: {
    exactMany: [
      "Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you.",
      "These people look like a great fit. Take your time, and when you've found the right person I'll draft the message for you.",
    ],
    exactOne: [
      "I found someone who could be a great fit. Take a look — if they feel right, I'll draft the message for you.",
      "Here's someone who looks like a strong match. If they feel right, I'll draft the message for you.",
    ],
    missing: (gap) => {
      if (gap.kind === 'subject') {
        return gap.role
          ? `I couldn't find anyone working as ${/^[aeiou]/i.test(gap.value) ? 'an' : 'a'} ${gap.value} here`
          : `I couldn't find anyone working in ${gap.value} here`;
      }
      if (gap.kind === 'place') return `I couldn't find anyone based in ${gap.value}`;
      if (gap.kind === 'busy') return `Nobody in ${gap.value} is free to talk right now`;
      return "I couldn't find an exact match";
    },
    closeMany: (terms) => terms
      ? `, but people in ${terms} are close and could still help.`
      : ', but these people are close and could still help.',
    closeOne: (terms) => terms
      ? `, but this person has a background in ${terms} and could still help.`
      : ', but this person is close and could still help.',
    actMany: [
      "Pick whoever looks most useful and I'll draft a message.",
      "Choose whoever looks most helpful and I'll draft a message.",
    ],
    actOne: [
      "If they look useful, I'll draft a message.",
      "If they look like a good fit, I'll draft a message.",
    ],
    retry: (strengths) => [
      `${strengths ? ` — most people in the network work in ${strengths}` : ''}. Could you tell me a bit more, like the industry, a job title or a skill you're after? I'll take another look.`,
      `${strengths ? ` — most people here are in ${strengths}` : ''}. Tell me a bit more, like an industry, a role or a skill, and I'll have another look.`,
    ],
    join: 'and',
  },
  Italian: {
    exactMany: [
      "Ottime notizie: ho trovato alcune persone che potrebbero davvero aiutarti. Dai un'occhiata e, quando trovi quella giusta, preparo io il messaggio.",
      'Queste persone sembrano proprio adatte. Prenditi il tempo che ti serve: quando hai scelto, preparo io il messaggio.',
    ],
    exactOne: [
      "Ho trovato una persona che potrebbe fare al caso tuo. Dai un'occhiata: se ti convince, preparo io il messaggio.",
      'Ecco una persona che sembra davvero adatta. Se ti convince, preparo io il messaggio.',
    ],
    missing: (gap) => {
      if (gap.kind === 'subject') {
        return gap.role
          ? `Non ho trovato nessuno che lavori come ${gap.value}`
          : `Non ho trovato nessuno che lavori in ambito ${gap.value}`;
      }
      if (gap.kind === 'place') return `Non ho trovato nessuno a ${gap.value}`;
      if (gap.kind === 'busy') return `Al momento nessuno a ${gap.value} è disponibile`;
      return 'Non ho trovato una corrispondenza esatta';
    },
    closeMany: (terms) => terms
      ? `, ma chi lavora in ${terms} ci va vicino e potrebbe comunque aiutarti.`
      : ', ma queste persone ci vanno vicino e potrebbero comunque aiutarti.',
    closeOne: (terms) => terms
      ? `, ma questa persona ha esperienza in ${terms} e potrebbe comunque aiutarti.`
      : ', ma questa persona ci va vicino e potrebbe comunque aiutarti.',
    actMany: [
      'Scegli chi ti sembra più utile e preparo io il messaggio.',
      'Scegli la persona che ti sembra più adatta e preparo io il messaggio.',
    ],
    actOne: [
      'Se ti sembra utile, preparo io il messaggio.',
      'Se ti convince, preparo io il messaggio.',
    ],
    retry: (strengths) => [
      `${strengths ? `: qui la maggior parte delle persone lavora in ${strengths}` : ''}. Puoi dirmi qualcosa in più, come il settore, un ruolo o una competenza che ti interessa? Riprovo subito.`,
      `${strengths ? `: qui la maggior parte delle persone è in ${strengths}` : ''}. Dimmi qualcosa in più, come un settore, un ruolo o una competenza, e ci riprovo.`,
    ],
    join: 'e',
  },
  French: {
    exactMany: [
      "Bonne nouvelle : j'ai trouvé quelques personnes qui pourraient vraiment vous aider. Jetez un œil et, quand quelqu'un vous semble bien, je rédige le message pour vous.",
      'Ces personnes semblent vraiment correspondre. Prenez votre temps : dès que vous avez choisi, je rédige le message pour vous.',
    ],
    exactOne: [
      "J'ai trouvé quelqu'un qui pourrait vraiment vous convenir. Jetez un œil : si le profil vous plaît, je rédige le message pour vous.",
      'Voici quelqu’un qui semble bien correspondre. Si le profil vous plaît, je rédige le message pour vous.',
    ],
    missing: (gap) => {
      if (gap.kind === 'subject') {
        return gap.role
          ? `Je n'ai trouvé personne qui travaille comme ${gap.value}`
          : `Je n'ai trouvé personne qui travaille en ${gap.value}`;
      }
      if (gap.kind === 'place') return `Je n'ai trouvé personne basé à ${gap.value}`;
      if (gap.kind === 'busy') return `Personne à ${gap.value} n'est disponible pour le moment`;
      return "Je n'ai pas trouvé de correspondance exacte";
    },
    closeMany: (terms) => terms
      ? `, mais des personnes en ${terms} s'en approchent et pourraient quand même vous aider.`
      : `, mais ces personnes s'en approchent et pourraient quand même vous aider.`,
    closeOne: (terms) => terms
      ? `, mais cette personne a de l'expérience en ${terms} et pourrait quand même vous aider.`
      : `, mais cette personne s'en approche et pourrait quand même vous aider.`,
    actMany: [
      'Choisissez la personne qui vous semble la plus utile et je rédige le message.',
      'Choisissez qui vous semble le plus pertinent et je rédige le message.',
    ],
    actOne: [
      'Si le profil vous semble utile, je rédige le message.',
      'Si cela vous convient, je rédige le message.',
    ],
    retry: (strengths) => [
      `${strengths ? ` — ici, la plupart des gens travaillent en ${strengths}` : ''}. Pouvez-vous m'en dire un peu plus, par exemple le secteur, un poste ou une compétence qui vous intéresse ? Je cherche à nouveau.`,
      `${strengths ? ` — ici, la plupart des gens sont en ${strengths}` : ''}. Dites-m'en un peu plus, comme un secteur, un poste ou une compétence, et je relance la recherche.`,
    ],
    join: 'et',
  },
};

const pick = <T>(options: T[], random: () => number) => options[Math.floor(random() * options.length) % options.length];

// Department and skill names are stored capitalised; mid-sentence they read
// better in lower case, except acronyms such as "LBO modelling".
const inSentence = (term: string) => term.split(' ').map((word) => (word === word.toUpperCase() ? word : word.toLowerCase())).join(' ');

function listOf(items: string[], join: string) {
  const words = items.map(inSentence);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} ${join} ${words[words.length - 1]}` : words.join('');
}

// Fields and skills read in lower case mid-sentence; places keep their capitals.
const asWritten = (gap: Gap): Gap => (gap.kind === 'subject' ? { ...gap, value: inSentence(gap.value) } : gap);

function copyFor(language: string) {
  return COPY[language] || COPY.English;
}

export function frameResults(language: string, options: {
  near: boolean; count: number; gap: Gap; closeTerms: string[]; random?: () => number;
}) {
  const copy = copyFor(language);
  const random = options.random || Math.random;
  const one = options.count === 1;
  if (!options.near) return pick(one ? copy.exactOne : copy.exactMany, random);
  const gap = asWritten(options.gap);
  const terms = listOf(options.closeTerms.slice(0, 2), copy.join);
  return `${copy.missing(gap)}${(one ? copy.closeOne : copy.closeMany)(terms)} ${pick(one ? copy.actOne : copy.actMany, random)}`;
}

export function frameNoMatch(language: string, gap: Gap, strengths: string[], random: () => number = Math.random) {
  const copy = copyFor(language);
  const shown = asWritten(gap);
  return `${copy.missing(shown)}${pick(copy.retry(listOf(strengths, copy.join)), random)}`;
}

// "I want to meet a painter" names a role; "someone in audit" names a field.
const ARTICLES: Record<string, string[]> = {
  English: ['a', 'an'], Italian: ['un', 'una', 'uno'], French: ['un', 'une'],
};
export function namesARole(language: string, userText: string, subject: string) {
  const words = userText.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = subject.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0];
  const articles = ARTICLES[language] || ARTICLES.English;
  return Boolean(first) && words.some((word, index) => word === first && articles.includes(words[index - 1]));
}
