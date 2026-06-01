import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Career descriptions are sometimes written in third person ("Ships features
// across the web app.") but should read in first person on a profile. This
// rewrites a leading third-person-singular present-tense verb to first person
// ("I ship features across the web app."). It only fires on a curated verb
// allowlist, so noun phrases ("Funnel and retention analysis."), gerunds
// ("Reporting and process analytics."), and past-tense resume bullets
// ("Owned the core product line.") are left untouched.
const THIRD_PERSON_VERBS = new Set([
  'ships', 'builds', 'leads', 'owns', 'runs', 'manages', 'coordinates',
  'designs', 'supports', 'drives', 'maintains', 'develops', 'oversees',
  'handles', 'delivers', 'creates', 'analyzes', 'analyses', 'writes',
  'organizes', 'organises', 'plans', 'directs', 'operates', 'implements',
  'produces', 'reports', 'researches', 'reviews', 'mentors', 'coaches',
  'guides', 'scales', 'optimizes', 'optimises', 'serves',
]);

function baseVerb(lower) {
  if (/(ches|shes|sses|xes)$/.test(lower)) return lower.slice(0, -2); // coaches -> coach
  if (lower.endsWith('ies')) return lower.slice(0, -3) + 'y';          // studies -> study
  if (lower.endsWith('s')) return lower.slice(0, -1);                  // ships -> ship
  return lower;
}

// De-pluralize a verb coordinated with "and" so compound bullets stay
// consistent ("...and supports the close." -> "...and support the close.").
function fixCoordinatedVerbs(str) {
  return str.replace(/(\band\s+)([A-Za-z]+)/g, (full, conj, verb) =>
    THIRD_PERSON_VERBS.has(verb.toLowerCase()) ? conj + baseVerb(verb.toLowerCase()) : full
  );
}

export function firstPersonize(text) {
  const s = (text ?? '').trim();
  if (!s) return text ?? '';
  if (/^I\b/.test(s)) return fixCoordinatedVerbs(s); // already first person
  const m = s.match(/^([A-Za-z]+)([\s\S]*)$/);
  if (!m) return s;
  const first = m[1];
  if (!THIRD_PERSON_VERBS.has(first.toLowerCase())) return s;
  return 'I ' + baseVerb(first.toLowerCase()) + fixCoordinatedVerbs(m[2]);
}
