// The parts of a request, read by Mistral and checked by code. The model is
// good at saying which words are a role, which an employer and which a field,
// and at choosing a department from a closed list; it is not trusted to decide
// anything. Every part must trace back to the user's own words, or to the
// network's own vocabulary, or it is dropped -- so a part can be missing, but
// never invented.

export type Parts = {
  role: string;
  seniority: '' | 'junior' | 'mid' | 'senior';
  field: string;
  department: string;
  company: string;
  skills: string[];
  exclude: string[];
  conflict: string[];
};

export const NO_PARTS: Parts = { role: '', seniority: '', field: '', department: '', company: '', skills: [], exclude: [], conflict: [] };

const clean = (value: unknown, max = 80) => String(value ?? '').trim().replace(/^["'“]+|["'”]+$/g, '').slice(0, max);
const words = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}&]+/u).filter((word) => word.length >= 2);
// Inflections and plurals: "consultants" is grounded in "consulting".
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

// Every meaningful word of the value must appear in the text. Partial overlap
// is how "a policy expert in France" slipped through on the word "policy".
export function groundedIn(value: string, text: string, ignore: Set<string> = new Set()) {
  const said = words(text);
  const own = words(value).filter((word) => word.length >= 3 && !ignore.has(word));
  return own.length > 0 && own.every((word) => said.some((other) => sameWord(word, other)));
}

// "forget finance", "not in consulting", "sans finance": words the user has
// ruled out, read by phrase so it works even when the model misses it.
const NEGATION = /\b(?:forget(?:\s+about)?|not(?:\s+in(?:to)?)?|except|excluding|without|apart\s+from|other\s+than|no\s+more|lascia\s+perdere|dimentica|tranne|senza|non\s+in|oublie[rz]?|sans|sauf|pas\s+(?:en|dans|la|le))\s+(?:the\s+|la\s+|le\s+|il\s+|lo\s+|les\s+|l')?([\p{L}&-]{3,})/giu;
export function negatedWords(text: string, ignore: Set<string> = new Set()) {
  // Only words that name something: "not what I want" rules nothing out.
  return [...text.matchAll(NEGATION)].map((match) => match[1].toLowerCase()).filter((word) => !ignore.has(word));
}

const SENIORITY = new Set(['junior', 'mid', 'senior']);

export function readParts(raw: unknown, context: {
  latest: string; userText: string; departments: string[]; ignore: Set<string>;
}): Parts {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const inLatest = (text: string) => groundedIn(text, context.latest, context.ignore);
  const said = (text: string) => groundedIn(text, context.userText, context.ignore);
  const list = (entry: unknown, limit: number) => (Array.isArray(entry) ? entry : typeof entry === 'string' ? [entry] : [])
    .map((item) => clean(item)).filter(Boolean).slice(0, limit);

  const exclude = [...new Set([...list(value.exclude, 4).filter(inLatest).map((item) => item.toLowerCase()),
    ...negatedWords(context.latest, context.ignore)])];
  const excluded = (text: string) => words(text).some((word) => exclude.some((gone) => words(gone).some((other) => sameWord(word, other))));
  const keep = (text: string) => text && said(text) && !excluded(text) ? text : '';

  const role = keep(clean(value.role));
  const field = keep(clean(value.field));
  // An employer must be written as the user wrote it, in this message.
  const companyRaw = clean(value.company, 60);
  const company = companyRaw && context.latest.toLowerCase().includes(companyRaw.toLowerCase()) && !excluded(companyRaw) ? companyRaw : '';
  const skills = list(value.skills, 4).filter((skill) => said(skill) && !excluded(skill));
  // A department is a choice from the network's own list, and only counts when
  // something the user said -- a field, an employer, a role -- supports it.
  // This is what lets "politique publique" reach Public Policy.
  const departmentRaw = clean(value.department).toLowerCase();
  const department = context.departments.find((name) => name.toLowerCase() === departmentRaw) || '';
  const supported = Boolean(field || company || role);
  const seniority = SENIORITY.has(clean(value.seniority).toLowerCase()) ? clean(value.seniority).toLowerCase() as Parts['seniority'] : '';
  // Two things that cannot both be true of one person ("a partner who is
  // still at school"). Both halves must be the user's words, in this message.
  const conflictParts = list(value.conflict, 2).filter((part) => words(part).length <= 8
    && words(part).some((word) => word.length >= 3 && words(context.latest).some((other) => sameWord(word, other))));
  const conflict = conflictParts.length === 2 && conflictParts[0].toLowerCase() !== conflictParts[1].toLowerCase() ? conflictParts : [];

  return {
    role, seniority, field, company, skills, exclude, conflict,
    department: department && supported && !excluded(department) ? department : '',
  };
}

// Removes ruled-out words before any lookup reads the message, so "forget
// finance, show me marketing" is read as "show me marketing".
export function withoutExcluded(text: string, exclude: string[]) {
  if (!exclude.length) return text;
  const gone = exclude.flatMap((item) => words(item));
  return text.split(/(\s+)/).filter((token) => {
    const own = words(token);
    return !own.length || !own.every((word) => gone.some((other) => sameWord(word, other)));
  }).join('').replace(/\s{2,}/g, ' ').trim();
}

export type Filter<T> = { key: 'subject' | 'company' | 'place'; keep: (item: T) => boolean };

// Applies every filter, and when together they leave nobody, lets go of one at
// a time -- the least important first -- and reports which were dropped, so
// the reply can say "nobody in operations in Lisbon, but here are operations
// people elsewhere" instead of returning nothing or the wrong department.
export function narrowStepwise<T>(items: T[], filters: Filter<T>[]) {
  // A subject that nobody carries cannot be kept, so it goes first; otherwise
  // the subject is what was asked for and goes last.
  const subjectPossible = filters.every((filter) => filter.key !== 'subject' || items.some(filter.keep));
  const order: Filter<T>['key'][] = subjectPossible ? ['place', 'company', 'subject'] : ['subject', 'place', 'company'];
  let active = [...filters];
  const relaxed: Filter<T>['key'][] = [];
  for (;;) {
    const kept = items.filter((item) => active.every((filter) => filter.keep(item)));
    if (kept.length || !active.length) return { kept, active: active.map((filter) => filter.key), relaxed };
    const drop = order.find((key) => active.some((filter) => filter.key === key));
    if (!drop) return { kept, active: active.map((filter) => filter.key), relaxed };
    active = active.filter((filter) => filter.key !== drop);
    relaxed.push(drop);
  }
}
