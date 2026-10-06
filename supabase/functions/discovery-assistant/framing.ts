import { repeats, sameOpening } from './voice.ts';
// Everything Ment says around the results. These are templates rather than
// model prose: the sentences set the tone and say what happens next, and the
// small model wrote them like compliance notices. Specifics come from real
// data -- what the user asked for, how many people came back, and which terms
// in the network are close -- so the wording stays specific without being
// improvised. Two phrasings per situation keep it from sounding canned.

export type Gap = {
  // subject: the thing asked for is not here; place: the city is not here;
  // busy: the city is here but nobody there is free; none: no exact match.
  // phrase: Mistral's checked description of the request ("a CFO who is
  // still a student"), which completes "I couldn't find ___ here".
  // company: nobody here has worked at the employer named; elsewhere: the
  // field is here, just not in the place named (scope holds the field).
  kind: 'subject' | 'place' | 'busy' | 'none' | 'phrase' | 'company' | 'elsewhere' | 'unreal';
  value: string;
  scope?: string;
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
      if (gap.kind === 'phrase') return `I couldn't find ${gap.value} here`;
      if (gap.kind === 'company') return `I couldn't find anyone who has worked at ${gap.value}`;
      if (gap.kind === 'unreal') return `Good one! I'm fairly sure ${gap.value} isn't a real place, so nobody here is based there`;
      if (gap.kind === 'elsewhere') return `I couldn't find anyone in ${gap.scope} in ${gap.value} right now`;
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
      if (gap.kind === 'phrase') return `Non ho trovato ${gap.value} qui`;
      if (gap.kind === 'company') return `Non ho trovato nessuno che abbia lavorato in ${gap.value}`;
      if (gap.kind === 'unreal') return `Bella questa! Sono abbastanza sicuro che ${gap.value} non sia un posto reale, quindi qui non c'è nessuno`;
      if (gap.kind === 'elsewhere') return `Al momento non ho trovato nessuno in ambito ${gap.scope} a ${gap.value}`;
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
      if (gap.kind === 'phrase') return `Je n'ai pas trouvé ${gap.value} ici`;
      if (gap.kind === 'company') return `Je n'ai trouvé personne ayant travaillé chez ${gap.value}`;
      if (gap.kind === 'unreal') return `Bien essayé ! Je suis presque sûr que ${gap.value} n'est pas un vrai lieu, donc personne ici n'y est basé`;
      if (gap.kind === 'elsewhere') return `Je n'ai trouvé personne en ${gap.scope} à ${gap.value} pour le moment`;
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
const asWritten = (gap: Gap): Gap => (gap.kind === 'subject' ? { ...gap, value: inSentence(gap.value) }
  : gap.kind === 'elsewhere' ? { ...gap, scope: inSentence(gap.scope || '') } : gap);

function copyFor(language: string) {
  return COPY[language] || COPY.English;
}

// The lead sentence of a two-sentence template.
const lead = (text: string) => text.split(/(?<=[.!])\s+/)[0];

// The people being shown, by first name and title, so the reply can talk
// about them the way a person would ("How about Theo, a CFO?") instead of
// "here are some people". Empty for redacted members.
export type Shown = { first: string; title: string };

// "a CFO", "an HR Director", "an Investment Associate".
const withArticle = (title: string) => {
  const acronym = /^[A-Z]{2,}/.test(title);
  const vowel = acronym ? /^[AEFHILMNORSX]/.test(title) : /^[aeiou]/i.test(title);
  return `${vowel ? 'an' : 'a'} ${title}`;
};

type Line = (person: Shown, count: number) => string;
type Lines = {
  exactOne: Line[]; exactMany: Line[]; differentOne: Line[]; differentMany: Line[];
  moreOne: Line[]; moreMany: Line[]; clarifiedOne: Line[]; clarifiedMany: Line[];
  closeOne: Line[]; closeMany: Line[];
};
const others = (count: number, one: string, many: string) => (count - 1 === 1 ? one : many.replace('{n}', String(count - 1)));

// Several ways to say each thing. Variants that name a person are used only
// when a name and title are known; the reply avoids anything said in the
// last two replies, so back-to-back messages never repeat themselves.
const LINES: Record<string, Lines> = {
  English: {
    exactOne: [
      (p) => `${p.first} looks like a strong fit — ${withArticle(p.title)}.`,
      (p) => `Meet ${p.first}, ${withArticle(p.title)}. I think they could really help.`,
      (p) => `I've got just the person: ${p.first}, ${withArticle(p.title)}.`,
    ],
    exactMany: [
      (p, n) => `I've found ${n} people who could really help — ${p.first}, ${withArticle(p.title)}, is a great place to start.`,
      (p, n) => `Good news: ${n} strong options here. Have a look at ${p.first} first — ${withArticle(p.title)}.`,
      (p, n) => `${n} people stand out for this, starting with ${p.first}, ${withArticle(p.title)}.`,
    ],
    differentOne: [
      (p) => `Fair enough — let's try another angle. How about ${p.first}, ${withArticle(p.title)}?`,
      (p) => `No problem, here's a fresh face: ${p.first}, ${withArticle(p.title)}.`,
      (p) => `Okay, scratch that! ${p.first} might be closer to what you have in mind — ${withArticle(p.title)}.`,
    ],
    differentMany: [
      (p, n) => `Fair enough — here are ${n} fresh faces, starting with ${p.first}, ${withArticle(p.title)}.`,
      (p, n) => `No problem, let's switch it up. ${p.first} (${p.title}) and ${others(n, 'one other', '{n} others')} might be closer.`,
      (p) => `Okay, new batch! Have a look at ${p.first}, ${withArticle(p.title)}, and the others below.`,
    ],
    moreOne: [
      (p) => `One more for you: ${p.first}, ${withArticle(p.title)}.`,
      (p) => `Here's another option — ${p.first}, ${withArticle(p.title)}.`,
    ],
    moreMany: [
      (p) => `A few more to consider, starting with ${p.first}, ${withArticle(p.title)}.`,
      (p, n) => `Here are ${n} more people — ${p.first} (${p.title}) is one to look at.`,
    ],
    clarifiedOne: [
      (p) => `No exact match for what you first asked — but with your clarification, ${p.first}, ${withArticle(p.title)}, looks like a really good fit!`,
      (p) => `That helps a lot! Your first request had no exact match, but ${p.first} (${p.title}) fits what you've described now.`,
    ],
    clarifiedMany: [
      (p, n) => `No exact match for what you first asked — but with your clarification I've found ${n} people who fit well, starting with ${p.first}, ${withArticle(p.title)}.`,
      (p) => `That helps a lot! Your first request had no exact match, but these people fit what you've described now — ${p.first} (${p.title}) especially.`,
    ],
    closeOne: [
      (p) => `, but ${p.first}, ${withArticle(p.title)}, comes pretty close and could still help.`,
      (p) => `, though ${p.first} (${p.title}) is close and could still be a great help.`,
    ],
    closeMany: [
      (p) => `, but ${p.first} (${p.title}) and the others below come pretty close.`,
      (p) => `, though these people are close — ${p.first}, ${withArticle(p.title)}, especially.`,
    ],
  },
  Italian: {
    exactOne: [
      (p) => `${p.first} (${p.title}) sembra proprio la persona giusta.`,
      (p) => `Ti presento ${p.first}, ${p.title}: credo possa davvero aiutarti.`,
      (p) => `Ho la persona che fa per te: ${p.first} (${p.title}).`,
    ],
    exactMany: [
      (p, n) => `Ho trovato ${n} persone che possono davvero aiutarti: ${p.first} (${p.title}) è un ottimo punto di partenza.`,
      (p, n) => `Buone notizie: ${n} ottime opzioni. Inizia da ${p.first}, ${p.title}.`,
    ],
    differentOne: [
      (p) => `Giusto, proviamo un'altra strada. Che ne dici di ${p.first} (${p.title})?`,
      (p) => `Nessun problema, ecco una persona nuova: ${p.first}, ${p.title}.`,
    ],
    differentMany: [
      (p, n) => `D'accordo, ecco ${n} persone nuove, a partire da ${p.first} (${p.title}).`,
      (p) => `Cambiamo un po': dai un'occhiata a ${p.first} (${p.title}) e agli altri qui sotto.`,
    ],
    moreOne: [(p) => `Eccone un'altra: ${p.first}, ${p.title}.`, (p) => `Un'altra opzione: ${p.first} (${p.title}).`],
    moreMany: [(p) => `Altre persone da considerare, a partire da ${p.first} (${p.title}).`],
    clarifiedOne: [(p) => `Per la tua prima richiesta non c'era una corrispondenza esatta, ma con il tuo chiarimento ${p.first} (${p.title}) sembra davvero adatto.`],
    clarifiedMany: [(p, n) => `Per la tua prima richiesta non c'era una corrispondenza esatta, ma con il tuo chiarimento ho trovato ${n} persone adatte, a partire da ${p.first} (${p.title}).`],
    closeOne: [(p) => `, ma ${p.first} (${p.title}) ci va molto vicino e potrebbe comunque aiutarti.`],
    closeMany: [(p) => `, ma ${p.first} (${p.title}) e gli altri qui sotto ci vanno vicino.`],
  },
  French: {
    exactOne: [
      (p) => `${p.first} (${p.title}) semble vraiment correspondre.`,
      (p) => `Je vous présente ${p.first}, ${p.title} : je pense qu'il ou elle peut vraiment vous aider.`,
      (p) => `J'ai la personne qu'il vous faut : ${p.first} (${p.title}).`,
    ],
    exactMany: [
      (p, n) => `J'ai trouvé ${n} personnes qui peuvent vraiment vous aider — ${p.first} (${p.title}) est un excellent point de départ.`,
      (p, n) => `Bonne nouvelle : ${n} belles options. Commencez par ${p.first}, ${p.title}.`,
    ],
    differentOne: [
      (p) => `D'accord, essayons autre chose. Que diriez-vous de ${p.first} (${p.title}) ?`,
      (p) => `Pas de souci, voici quelqu'un de nouveau : ${p.first}, ${p.title}.`,
    ],
    differentMany: [
      (p, n) => `D'accord, voici ${n} nouvelles personnes, à commencer par ${p.first} (${p.title}).`,
      (p) => `Changeons un peu : regardez ${p.first} (${p.title}) et les autres ci-dessous.`,
    ],
    moreOne: [(p) => `En voici une autre : ${p.first}, ${p.title}.`, (p) => `Autre option : ${p.first} (${p.title}).`],
    moreMany: [(p) => `D'autres personnes à considérer, à commencer par ${p.first} (${p.title}).`],
    clarifiedOne: [(p) => `Pas de correspondance exacte pour votre première demande, mais avec votre précision, ${p.first} (${p.title}) semble vraiment convenir.`],
    clarifiedMany: [(p, n) => `Pas de correspondance exacte pour votre première demande, mais avec votre précision j'ai trouvé ${n} personnes qui conviennent, à commencer par ${p.first} (${p.title}).`],
    closeOne: [(p) => `, mais ${p.first} (${p.title}) s'en approche beaucoup et pourrait quand même vous aider.`],
    closeMany: [(p) => `, mais ${p.first} (${p.title}) et les autres ci-dessous s'en approchent.`],
  },
};

// Picks a phrasing that repeats nothing from the last replies, when one does.
function fresh(options: string[], recent: string[], random: () => number) {
  const unused = options.filter((text) => !repeats(text, recent) && !sameOpening(text, recent));
  return pick(unused.length ? unused : options, random);
}

export function frameResults(language: string, options: {
  near: boolean; count: number; gap: Gap; closeTerms: string[]; more?: boolean; different?: boolean; clarified?: boolean;
  // The first results of the conversation say what to do next; later ones
  // do not repeat it -- "happy to show more, just say" every time is how a
  // chatbot talks.
  first?: boolean; person?: Shown; recent?: string[]; random?: () => number;
}) {
  const copy = copyFor(language);
  const lines = LINES[language] || LINES.English;
  const random = options.random || Math.random;
  const recent = options.recent || [];
  const one = options.count === 1;
  const first = options.first !== false;
  const person = options.person?.first && options.person?.title ? options.person : null;
  const named = (list: Line[]) => (person ? list.map((line) => line(person, options.count)) : []);
  const act = first ? ` ${pick(one ? copy.actOne : copy.actMany, random)}` : '';
  const offer = first ? ` ${pick(copy.followUp, random)}` : '';
  const full = (text: string) => (first ? text : lead(text));
  if (options.more) {
    return `${fresh([...(one ? copy.moreOne : copy.moreMany).map(full), ...named(one ? lines.moreOne : lines.moreMany)], recent, random)}${offer}`;
  }
  // After the user answered a question asked because nothing matched
  // exactly: say the first request had no exact match, and credit the answer.
  if (options.clarified) {
    return `${fresh([(CLARIFIED[language] || CLARIFIED.English)(one), ...named(one ? lines.clarifiedOne : lines.clarifiedMany)], recent, random)}${act}${offer}`;
  }
  if (options.different) {
    return `${fresh([(DIFFERENT[language] || DIFFERENT.English)(one), ...named(one ? lines.differentOne : lines.differentMany)], recent, random)}${act}${offer}`;
  }
  if (!options.near) {
    return `${fresh([...(one ? copy.exactOne : copy.exactMany).map(full), ...named(one ? lines.exactOne : lines.exactMany)], recent, random)}${offer}`;
  }
  const gap = asWritten(options.gap);
  const terms = listOf(options.closeTerms.slice(0, 2), copy.join);
  // With close terms the generic tail names them, which is the more useful
  // sentence; the named tails are for when there are none to name.
  const tails = terms ? [(one ? copy.closeOne : copy.closeMany)(terms)] : [(one ? copy.closeOne : copy.closeMany)(''), ...named(one ? lines.closeOne : lines.closeMany)];
  return `${copy.missing(gap)}${fresh(tails, recent, random)}${act}${offer}`;
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
  if (gap.kind === 'place' || gap.kind === 'busy' || gap.kind === 'elsewhere' || gap.kind === 'unreal') return `${copy.missing(shown)}${PLACE_RETRY[language] || PLACE_RETRY.English}`;
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
// href makes it a link (to Explore) instead of a reply.
export type Choice = { label: string; message: string; href?: string };

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

const SAME_PEOPLE: Record<string, (one: boolean) => string> = {
  English: (one) => one
    ? "That's the same person I showed you before — they're still the best fit for that. Want me to try a different angle?"
    : "These are the same people I showed you before — they're still the best fit for that. Want me to try a different angle?",
  Italian: (one) => one
    ? 'È la stessa persona che ti ho mostrato prima: resta la più adatta. Vuoi che provi da un’altra angolazione?'
    : 'Sono le stesse persone che ti ho mostrato prima: restano le più adatte. Vuoi che provi da un’altra angolazione?',
  French: (one) => one
    ? 'C’est la même personne que je vous ai montrée — elle reste la plus pertinente. Voulez-vous que j’essaie sous un autre angle ?'
    : 'Ce sont les mêmes personnes que je vous ai montrées — elles restent les plus pertinentes. Voulez-vous que j’essaie sous un autre angle ?',
};
const SOME_REPEATED: Record<string, (fresh: number) => string> = {
  English: (fresh) => fresh === 1 ? 'One of these is new; the others you have already seen.' : `${fresh} of these are new; the others you have already seen.`,
  Italian: (fresh) => fresh === 1 ? 'Una di queste è nuova; le altre le hai già viste.' : `${fresh} di queste sono nuove; le altre le hai già viste.`,
  French: (fresh) => fresh === 1 ? 'Une de ces personnes est nouvelle ; vous avez déjà vu les autres.' : `${fresh} de ces personnes sont nouvelles ; vous avez déjà vu les autres.`,
};
export function frameSamePeople(language: string, count: number) {
  return (SAME_PEOPLE[language] || SAME_PEOPLE.English)(count === 1);
}
export function frameSomeRepeated(language: string, fresh: number) {
  return (SOME_REPEATED[language] || SOME_REPEATED.English)(fresh);
}

const REJECTED_NONE: Record<string, (subject: string) => string> = {
  English: (subject) => subject
    ? `Sorry about that — nobody here works in ${subject} directly, so those were only the closest I could find. Want me to try a different angle?`
    : 'Sorry about that — those were the closest I could find. Want me to try a different angle?',
  Italian: (subject) => subject
    ? `Scusa, hai ragione: qui nessuno lavora direttamente in ambito ${subject}, quelle erano solo le persone più vicine. Vuoi che provi da un’altra angolazione?`
    : 'Scusa: quelle erano le persone più vicine che ho trovato. Vuoi che provi da un’altra angolazione?',
  French: (subject) => subject
    ? `Désolé — personne ici ne travaille directement en ${subject}, c’étaient seulement les profils les plus proches. Voulez-vous que j’essaie sous un autre angle ?`
    : 'Désolé — c’étaient les profils les plus proches que j’ai trouvés. Voulez-vous que j’essaie sous un autre angle ?',
};
export function frameRejectedNone(language: string, subject: string) {
  return (REJECTED_NONE[language] || REJECTED_NONE.English)(inSentence(subject));
}

const CLARIFIED: Record<string, (one: boolean) => string> = {
  English: (one) => `Your first request had no exact match — but with your clarification, I think ${one ? 'this person is a really good fit' : 'these people are a really good fit'}!`,
  Italian: (one) => `Non ho trovato una corrispondenza esatta per la tua richiesta iniziale, ma con il tuo chiarimento credo che ${one ? 'questa persona sia adatta' : 'queste persone siano adatte'}.`,
  French: (one) => `Je n'ai pas trouvé de correspondance exacte pour votre demande initiale, mais avec votre précision, je pense que ${one ? 'cette personne convient bien' : 'ces personnes conviennent bien'}.`,
};

const DIFFERENT: Record<string, (one: boolean) => string> = {
  English: (one) => one ? "Got it — here's someone different." : 'Got it — here are some different people.',
  Italian: (one) => one ? 'Capito, ecco una persona diversa.' : 'Capito, ecco qualche persona diversa.',
  French: (one) => one ? 'Compris — voici quelqu’un d’autre.' : 'Compris — voici d’autres personnes.',
};

// Contact details, a named person, or the whole directory: say what the chat
// is for and point to Explore, never search.
const PRIVACY: Record<string, (name: string) => string> = {
  English: (name) => `I can't share anyone's contact details${name ? `, including ${name}'s` : ''} — if you want to reach someone, I can draft an intro you send through Ment. To look someone up by name, use Explore. Or tell me what you need help with — a skill, a role or an industry.`,
  Italian: (name) => `Non posso condividere i contatti di nessuno${name ? `, nemmeno di ${name}` : ''}: se vuoi contattare qualcuno, preparo io una presentazione da inviare tramite Ment. Per cercare una persona per nome usa Esplora. Oppure dimmi con cosa ti serve aiuto: una competenza, un ruolo o un settore.`,
  French: (name) => `Je ne peux partager les coordonnées de personne${name ? `, y compris celles de ${name}` : ''} — si vous voulez contacter quelqu’un, je rédige une présentation à envoyer via Ment. Pour chercher quelqu’un par son nom, utilisez Explorer. Ou dites-moi sur quoi vous voulez de l’aide : une compétence, un poste ou un secteur.`,
};
const DIRECTORY: Record<string, string> = {
  English: "I can't list everyone or share contact details — to browse the whole network, use Explore. I'm here to find the right people by skill, experience or industry. What are you looking for?",
  Italian: 'Non posso elencare tutti né condividere contatti: per sfogliare tutta la rete usa Esplora. Io ti aiuto a trovare le persone giuste per competenza, esperienza o settore. Cosa stai cercando?',
  French: 'Je ne peux pas lister tout le monde ni partager de coordonnées — pour parcourir tout le réseau, utilisez Explorer. Je suis là pour trouver les bonnes personnes par compétence, expérience ou secteur. Que cherchez-vous ?',
};
const PERSON: Record<string, (name: string) => string> = {
  English: (name) => `Looking for ${name} specifically? You can find them by name in Explore. I'm best at finding people by skill, experience or industry — tell me what you need help with.`,
  Italian: (name) => `Cerchi proprio ${name}? Puoi trovarlo per nome in Esplora. Io do il meglio trovando persone per competenza, esperienza o settore: dimmi con cosa ti serve aiuto.`,
  French: (name) => `Vous cherchez ${name} en particulier ? Vous pouvez le trouver par son nom dans Explorer. Je suis surtout utile pour trouver des personnes par compétence, expérience ou secteur — dites-moi ce dont vous avez besoin.`,
};
const EXPLORE_LABEL: Record<string, (name: string) => string> = {
  English: (name) => name ? `Find ${name} in Explore` : 'Open Explore',
  Italian: (name) => name ? `Cerca ${name} in Esplora` : 'Apri Esplora',
  French: (name) => name ? `Chercher ${name} dans Explorer` : 'Ouvrir Explorer',
};
const WHICH_FIRST: Record<string, string> = {
  English: 'Happy to help with both — which would you like to start with?',
  Italian: 'Ti aiuto volentieri con entrambe: da quale vuoi partire?',
  French: 'Avec plaisir pour les deux — par laquelle voulez-vous commencer ?',
};
export function framePrivacy(language: string, name: string) { return (PRIVACY[language] || PRIVACY.English)(name); }
export function frameDirectory(language: string) { return DIRECTORY[language] || DIRECTORY.English; }
export function framePerson(language: string, name: string) { return (PERSON[language] || PERSON.English)(name); }
export function frameWhichFirst(language: string) { return WHICH_FIRST[language] || WHICH_FIRST.English; }
export function exploreChoice(language: string, name: string): Choice {
  return { label: (EXPLORE_LABEL[language] || EXPLORE_LABEL.English)(name), message: '', href: name ? `/explorer?q=${encodeURIComponent(name)}` : '/explorer' };
}

// Two parts of one request that do not fit one person: ask which matters,
// with each part as a choice, rather than searching for the impossible.
const CONFLICT: Record<string, (a: string, b: string) => string> = {
  English: (a, b) => `I like the ambition! But "${a}" and "${b}" rarely describe the same person — which matters more to you?`,
  Italian: (a, b) => `Una verifica: "${a}" e "${b}" di solito non descrivono la stessa persona. Cosa conta di più per te?`,
  French: (a, b) => `Petite vérification : « ${a} » et « ${b} » décrivent rarement la même personne. Qu'est-ce qui compte le plus pour vous ?`,
};
export function frameConflict(language: string, parts: string[]) {
  return (CONFLICT[language] || CONFLICT.English)(parts[0], parts[1]);
}
export function conflictChoices(parts: string[]): Choice[] {
  return parts.map((part) => ({ label: part, message: part }));
}

// Scoping before answering. When the search can only offer people who are
// close rather than exact -- the employer, the city or the field is not
// here -- or when many people fit a one-word request, ask which way to go,
// with choices taken from the people actually available, instead of showing
// a "no exact match" result straight away.
type ScopeCopy = {
  company: (scope: string) => string;
  place: (cities: string) => string;
  subject: string;
  broad: string;
  closest: Choice;
  best: Choice;
  anywhere: (scope: string) => Choice;
  otherCompanies: (scope: string, place: string) => Choice;
  inCity: (scope: string, city: string) => Choice;
  join: string;
};
const SCOPE: Record<string, ScopeCopy> = {
  English: {
    company: (scope) => `. Would ${scope ? `${scope} from another company` : 'someone from another company'} do the trick, or shall I show you the closest people I've got?`,
    place: (cities) => `. Would ${cities} work for you, or shall I look anywhere?`,
    subject: '. Could one of these nearby areas do the trick?',
    broad: "Good news — quite a few people fit that! Want to narrow it down a little, say by a skill or where they're based?",
    closest: { label: 'Show me the closest', message: 'Show me the closest people' },
    best: { label: 'Show me the best matches', message: 'Show me the best matches' },
    anywhere: (scope) => ({ label: 'Anywhere', message: scope ? `${scope}, anywhere` : 'anywhere' }),
    otherCompanies: (scope, place) => ({ label: `${scope} at other companies`, message: `${scope}${place ? ` in ${place}` : ''}, any company` }),
    inCity: (scope, city) => ({ label: city, message: scope ? `${scope} in ${city}` : `in ${city}` }),
    join: 'or',
  },
  Italian: {
    company: (scope) => `. Andrebbe bene ${scope ? `${scope} di altre aziende` : 'qualcuno di altre aziende'}, o ti mostro le persone più vicine?`,
    place: (cities) => `. Va bene ${cities}, o ovunque?`,
    subject: '. Una di queste potrebbe andare bene?',
    broad: "Ci sono parecchie persone adatte. C'è qualcosa che conta di più per te, una competenza o la città?",
    closest: { label: 'Mostrami i più vicini', message: 'Mostrami i più vicini' },
    best: { label: 'Mostrami i migliori', message: 'Mostrami i migliori' },
    anywhere: (scope) => ({ label: 'Ovunque', message: scope ? `${scope}, ovunque` : 'ovunque' }),
    otherCompanies: (scope, place) => ({ label: `${scope} in altre aziende`, message: `${scope}${place ? ` a ${place}` : ''}, qualsiasi azienda` }),
    inCity: (scope, city) => ({ label: city, message: scope ? `${scope} a ${city}` : `a ${city}` }),
    join: 'o',
  },
  French: {
    company: (scope) => `. Des profils ${scope ? `${scope} d'autres entreprises` : "d'autres entreprises"} vous conviendraient-ils, ou je vous montre les plus proches ?`,
    place: (cities) => `. ${cities} vous conviendrait, ou n'importe où ?`,
    subject: '. L’une de ces pistes pourrait-elle convenir ?',
    broad: "Plusieurs personnes correspondent. Qu'est-ce qui compte le plus pour vous — une compétence, ou la ville ?",
    closest: { label: 'Montrez-moi les plus proches', message: 'Montrez-moi les plus proches' },
    best: { label: 'Montrez-moi les meilleurs', message: 'Montrez-moi les meilleurs' },
    anywhere: (scope) => ({ label: "N'importe où", message: scope ? `${scope}, n'importe où` : "n'importe où" }),
    otherCompanies: (scope, place) => ({ label: `${scope} dans d'autres entreprises`, message: `${scope}${place ? ` à ${place}` : ''}, n'importe quelle entreprise` }),
    inCity: (scope, city) => ({ label: city, message: scope ? `${scope} à ${city}` : `à ${city}` }),
    join: 'ou',
  },
};

// Places keep their capitals, unlike fields in listOf.
const joinPlaces = (items: string[], join: string) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} ${join} ${items[items.length - 1]}` : items.join(''));

export function frameScope(language: string, options: {
  gap: Gap; scope: string; place: string; cities: string[]; terms: string[]; skills: string[];
}): { question: string; choices: Choice[] } | null {
  const copy = SCOPE[language] || SCOPE.English;
  const missing = copyFor(language).missing(asWritten(options.gap));
  const scope = options.scope ? inSentence(options.scope) : '';
  if (options.gap.kind === 'company') {
    const choices = scope ? [copy.otherCompanies(scope, options.place), copy.closest] : [copy.closest];
    return { question: `${missing}${copy.company(scope)}`, choices };
  }
  if (options.gap.kind === 'place' || options.gap.kind === 'busy' || options.gap.kind === 'elsewhere' || options.gap.kind === 'unreal') {
    if (!options.cities.length) return null;
    return {
      question: `${missing}${copy.place(joinPlaces(options.cities, copy.join))}`,
      choices: [...options.cities.map((city) => copy.inCity(scope, city)), copy.anywhere(scope)],
    };
  }
  if (options.gap.kind === 'subject' || options.gap.kind === 'phrase' || options.gap.kind === 'none') {
    if (!options.terms.length) return null;
    return { question: `${missing}${copy.subject}`, choices: [...options.terms.map((term) => ({ label: term, message: term })), copy.closest] };
  }
  return null;
}

export function frameBroad(language: string, options: { scope: string; skills: string[]; cities: string[] }) {
  const copy = SCOPE[language] || SCOPE.English;
  const scope = options.scope ? inSentence(options.scope) : '';
  const choices = [
    ...options.skills.map((skill) => ({ label: skill, message: skill })),
    ...options.cities.map((city) => copy.inCity(scope, city)),
    copy.best,
  ];
  return { question: copy.broad, choices };
}
