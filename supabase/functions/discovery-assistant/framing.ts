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
  greeting: (examples: string) => string;
  thanks: string[];
  moreMany: string[];
  moreOne: string[];
  exhausted: string[];
  followUp: string[];
  narrow: string;
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
    greeting: (examples) => `Hi! I'm Ment — I help you find people in the ESSEC network who can help with your studies or career, and I'll draft the intro message for you. What are you looking for?${examples ? ` For example a field like ${examples}, a skill, or a type of role.` : ''}`,
    thanks: ["You're welcome! Anything else I can help you find?", 'Happy to help — just say if you want to look for someone else.'],
    moreMany: ["Here are a few more people who could help. Pick whoever looks most useful and I'll draft a message."],
    moreOne: ["Here's one more person who could help. If they look useful, I'll draft a message."],
    exhausted: ["That's everyone who fits this search for now. Want me to widen it — a nearby field, another city, or a different skill?"],
    followUp: ['Want more options, or should I narrow it down?', 'Happy to show more people or narrow it down — just say.'],
    narrow: 'Happy to narrow it down — what matters most to you: a particular city, how senior they are, or a specific skill?',
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
    greeting: (examples) => `Ciao! Sono Ment: ti aiuto a trovare persone nella rete ESSEC che possono aiutarti negli studi o nella carriera, e preparo io il messaggio di presentazione. Cosa stai cercando?${examples ? ` Per esempio un settore come ${examples}, una competenza o un tipo di ruolo.` : ''}`,
    thanks: ['Figurati! Posso aiutarti a trovare qualcun altro?', 'Con piacere: dimmi pure se vuoi cercare qualcun altro.'],
    moreMany: ['Ecco altre persone che potrebbero aiutarti. Scegli chi ti sembra più utile e preparo io il messaggio.'],
    moreOne: ['Ecco un’altra persona che potrebbe aiutarti. Se ti sembra utile, preparo io il messaggio.'],
    exhausted: ['Per questa ricerca non ci sono altre persone adatte al momento. Vuoi che allarghi la ricerca, a un settore vicino, un’altra città o una competenza diversa?'],
    followUp: ['Vuoi vedere altre persone o restringere la ricerca?', 'Posso mostrarti altre persone o restringere la ricerca: dimmi tu.'],
    narrow: 'Volentieri, restringiamo la ricerca: cosa conta di più per te, una città in particolare, il livello di seniority o una competenza precisa?',
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
    greeting: (examples) => `Bonjour ! Je suis Ment : je vous aide à trouver des personnes du réseau ESSEC qui peuvent vous aider dans vos études ou votre carrière, et je rédige le message de présentation. Que cherchez-vous ?${examples ? ` Par exemple un domaine comme ${examples}, une compétence ou un type de poste.` : ''}`,
    thanks: ['Avec plaisir ! Puis-je vous aider à trouver quelqu’un d’autre ?', 'Ravi d’aider — dites-moi si vous voulez chercher quelqu’un d’autre.'],
    moreMany: ['Voici quelques autres personnes qui pourraient vous aider. Choisissez celle qui vous semble la plus utile et je rédige le message.'],
    moreOne: ['Voici une autre personne qui pourrait vous aider. Si le profil vous semble utile, je rédige le message.'],
    exhausted: ['C’est tout le monde pour cette recherche pour le moment. Voulez-vous que j’élargisse — un domaine voisin, une autre ville ou une autre compétence ?'],
    followUp: ['Voulez-vous plus de profils, ou que j’affine la recherche ?', 'Je peux vous montrer d’autres personnes ou affiner la recherche — dites-moi.'],
    narrow: 'Avec plaisir, affinons : qu’est-ce qui compte le plus pour vous — une ville en particulier, le niveau d’expérience ou une compétence précise ?',
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
  near: boolean; count: number; gap: Gap; closeTerms: string[]; more?: boolean; random?: () => number;
}) {
  const copy = copyFor(language);
  const random = options.random || Math.random;
  const one = options.count === 1;
  // Every set of results ends on an open door, never a one-shot answer.
  const followUp = pick(copy.followUp, random);
  if (options.more) return `${pick(one ? copy.moreOne : copy.moreMany, random)} ${followUp}`;
  if (!options.near) return `${pick(one ? copy.exactOne : copy.exactMany, random)} ${followUp}`;
  const gap = asWritten(options.gap);
  const terms = listOf(options.closeTerms.slice(0, 2), copy.join);
  return `${copy.missing(gap)}${(one ? copy.closeOne : copy.closeMany)(terms)} ${pick(one ? copy.actOne : copy.actMany, random)} ${followUp}`;
}

export function frameChat(language: string, intent: string, examples: string, random: () => number = Math.random) {
  const copy = copyFor(language);
  return intent === 'thanks' ? pick(copy.thanks, random) : copy.greeting(examples);
}

export function frameNarrow(language: string) {
  return copyFor(language).narrow;
}

export function frameExhausted(language: string, random: () => number = Math.random) {
  return pick(copyFor(language).exhausted, random);
}

const PLACE_RETRY: Record<string, string> = {
  English: '. Want me to look in another city, or anywhere in the network?',
  Italian: '. Vuoi che cerchi in un’altra città, o ovunque nella rete?',
  French: '. Voulez-vous que je cherche dans une autre ville, ou n’importe où dans le réseau ?',
};

export function frameNoMatch(language: string, gap: Gap, strengths: string[], random: () => number = Math.random) {
  const copy = copyFor(language);
  const shown = asWritten(gap);
  // A missing place is about the place: asking for an industry the user has
  // already given made the reply read like it had not been listening.
  if (gap.kind === 'place' || gap.kind === 'busy') return `${copy.missing(shown)}${PLACE_RETRY[language] || PLACE_RETRY.English}`;
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

// Tappable choices shown under a question. The label is what the button says;
// the message is what gets sent, phrased so the funnel reads it like typed text.
export type Choice = { label: string; message: string };

const CHOICE_COPY: Record<string, {
  invite: string;
  openAgain: string;
  interestedIn: (field: string) => string;
  scope: Choice[];
  senior: Choice;
  onlyIn: (place: string) => Choice;
}> = {
  English: {
    invite: 'Pick one below, or tell me in your own words.',
    openAgain: "No problem — here are a few places people often start. What would you like help with?",
    interestedIn: (field) => `I'm interested in ${field}`,
    scope: [
      { label: 'A specific skill', message: 'a specific skill' },
      { label: 'A type of role', message: 'a type of role' },
      { label: 'Career advice', message: 'career advice' },
    ],
    senior: { label: 'More senior people', message: 'more senior people' },
    onlyIn: (place) => ({ label: `Only in ${place}`, message: `only in ${place}` }),
  },
  Italian: {
    invite: 'Scegli qui sotto, oppure scrivimelo con parole tue.',
    openAgain: 'Nessun problema: ecco alcuni punti da cui si parte spesso. Con cosa ti serve aiuto?',
    interestedIn: (field) => `Mi interessa ${field}`,
    scope: [
      { label: 'Una competenza precisa', message: 'una competenza precisa' },
      { label: 'Un tipo di ruolo', message: 'un tipo di ruolo' },
      { label: 'Consigli di carriera', message: 'consigli di carriera' },
    ],
    senior: { label: 'Persone più senior', message: 'persone più senior' },
    onlyIn: (place) => ({ label: `Solo a ${place}`, message: `solo a ${place}` }),
  },
  French: {
    invite: 'Choisissez ci-dessous, ou dites-le-moi avec vos mots.',
    openAgain: 'Pas de souci — voici quelques points de départ fréquents. Sur quoi aimeriez-vous de l’aide ?',
    interestedIn: (field) => `Je m'intéresse à ${field}`,
    scope: [
      { label: 'Une compétence précise', message: 'une compétence précise' },
      { label: 'Un type de poste', message: 'un type de poste' },
      { label: 'Des conseils de carrière', message: 'des conseils de carrière' },
    ],
    senior: { label: 'Profils plus seniors', message: 'profils plus seniors' },
    onlyIn: (place) => ({ label: `Uniquement à ${place}`, message: `uniquement à ${place}` }),
  },
};
const choiceCopy = (language: string) => CHOICE_COPY[language] || CHOICE_COPY.English;

export function departmentChoices(language: string, departments: string[]): Choice[] {
  return departments.map((name) => ({ label: name, message: choiceCopy(language).interestedIn(inSentence(name)) }));
}
export function scopeChoices(language: string): Choice[] {
  return choiceCopy(language).scope;
}
export function narrowChoices(language: string, places: string[]): Choice[] {
  const copy = choiceCopy(language);
  return [copy.senior, ...places.map((place) => copy.onlyIn(place))];
}
export function ownWordsInvite(language: string) {
  return choiceCopy(language).invite;
}
export function frameOpenAgain(language: string) {
  return choiceCopy(language).openAgain;
}

const REFINE_NONE: Record<string, string> = {
  English: "Nobody here matches that extra requirement — the people I showed you before are still the closest fit in the network. Want me to try a different angle?",
  Italian: 'Nessuno qui soddisfa anche questo requisito: le persone che ti ho mostrato prima restano le più vicine nella rete. Vuoi che provi da un’altra angolazione?',
  French: 'Personne ici ne correspond à ce critère supplémentaire — les personnes que je vous ai montrées restent les plus proches dans le réseau. Voulez-vous que j’essaie sous un autre angle ?',
};
export function frameRefineNone(language: string) {
  return REFINE_NONE[language] || REFINE_NONE.English;
}

const SMALL_TALK: Record<string, string[]> = {
  English: [
    "All good here, thanks for asking! How about you? Shall we get cracking — meeting someone new or learning a new skill?",
    "Doing great, thanks! How are things on your side? Want to find someone interesting to talk to, or pick up a new skill?",
  ],
  Italian: [
    'Tutto bene, grazie! E tu come stai? Ci mettiamo all’opera: vuoi conoscere qualcuno di nuovo o imparare una nuova competenza?',
    'Alla grande, grazie! Tu come va? Che ne dici di trovare qualcuno con cui parlare o una nuova competenza da imparare?',
  ],
  French: [
    'Tout va bien, merci ! Et vous ? On s’y met : rencontrer quelqu’un de nouveau ou apprendre une nouvelle compétence ?',
    'Très bien, merci ! Et de votre côté ? Envie de rencontrer quelqu’un d’intéressant ou d’apprendre une nouvelle compétence ?',
  ],
};
export function frameSmallTalk(language: string, random: () => number = Math.random) {
  const options = SMALL_TALK[language] || SMALL_TALK.English;
  return options[Math.floor(random() * options.length) % options.length];
}

const NUDGE: Record<string, string[]> = {
  English: ['Shall we get cracking — meeting someone new or learning a new skill?', 'Ready to meet someone new or pick up a new skill?'],
  Italian: ['Ci mettiamo all’opera: vuoi conoscere qualcuno di nuovo o imparare una nuova competenza?', 'Pronto a conoscere qualcuno di nuovo o imparare una nuova competenza?'],
  French: ['On s’y met : rencontrer quelqu’un de nouveau ou apprendre une nouvelle compétence ?', 'Prêt à rencontrer quelqu’un de nouveau ou à apprendre une nouvelle compétence ?'],
};
export function frameNudge(language: string, random: () => number = Math.random) {
  const options = NUDGE[language] || NUDGE.English;
  return options[Math.floor(random() * options.length) % options.length];
}
