// Countries the network has no city in. A city has to be known or capitalised
// to count as a place; a country is one however it is typed ("en chine"), and
// each language needs its own way to say "in China".
type Country = { names: string[]; en: string; fr: string; it: string };

const COUNTRIES: Country[] = [
  { names: ['china', 'chine', 'cina'], en: 'China', fr: 'en Chine', it: 'in Cina' },
  { names: ['japan', 'japon', 'giappone'], en: 'Japan', fr: 'au Japon', it: 'in Giappone' },
  { names: ['india', 'inde'], en: 'India', fr: 'en Inde', it: 'in India' },
  { names: ['russia', 'russie'], en: 'Russia', fr: 'en Russie', it: 'in Russia' },
  { names: ['turkey', 'turquie', 'turchia'], en: 'Turkey', fr: 'en Turquie', it: 'in Turchia' },
  { names: ['egypt', 'égypte', 'egypte', 'egitto'], en: 'Egypt', fr: 'en Égypte', it: 'in Egitto' },
  { names: ['south africa', 'afrique du sud', 'sudafrica'], en: 'South Africa', fr: 'en Afrique du Sud', it: 'in Sudafrica' },
  { names: ['nigeria', 'nigéria'], en: 'Nigeria', fr: 'au Nigéria', it: 'in Nigeria' },
  { names: ['kenya'], en: 'Kenya', fr: 'au Kenya', it: 'in Kenya' },
  { names: ['senegal', 'sénégal'], en: 'Senegal', fr: 'au Sénégal', it: 'in Senegal' },
  { names: ['tunisia', 'tunisie'], en: 'Tunisia', fr: 'en Tunisie', it: 'in Tunisia' },
  { names: ['algeria', 'algérie', 'algerie'], en: 'Algeria', fr: 'en Algérie', it: 'in Algeria' },
  { names: ['argentina', 'argentine'], en: 'Argentina', fr: 'en Argentine', it: 'in Argentina' },
  { names: ['chile', 'chili', 'cile'], en: 'Chile', fr: 'au Chili', it: 'in Cile' },
  { names: ['colombia', 'colombie'], en: 'Colombia', fr: 'en Colombie', it: 'in Colombia' },
  { names: ['peru', 'pérou', 'perou', 'perù'], en: 'Peru', fr: 'au Pérou', it: 'in Perù' },
  { names: ['thailand', 'thaïlande', 'thailande', 'thailandia'], en: 'Thailand', fr: 'en Thaïlande', it: 'in Thailandia' },
  { names: ['vietnam', 'viêt nam'], en: 'Vietnam', fr: 'au Vietnam', it: 'in Vietnam' },
  { names: ['indonesia', 'indonésie', 'indonesie'], en: 'Indonesia', fr: 'en Indonésie', it: 'in Indonesia' },
  { names: ['philippines', 'filippine'], en: 'the Philippines', fr: 'aux Philippines', it: 'nelle Filippine' },
  { names: ['malaysia', 'malaisie', 'malesia'], en: 'Malaysia', fr: 'en Malaisie', it: 'in Malesia' },
  { names: ['taiwan', 'taïwan'], en: 'Taiwan', fr: 'à Taïwan', it: 'a Taiwan' },
  { names: ['pakistan'], en: 'Pakistan', fr: 'au Pakistan', it: 'in Pakistan' },
  { names: ['bangladesh'], en: 'Bangladesh', fr: 'au Bangladesh', it: 'in Bangladesh' },
  { names: ['saudi arabia', 'arabie saoudite', 'arabia saudita'], en: 'Saudi Arabia', fr: 'en Arabie saoudite', it: 'in Arabia Saudita' },
  { names: ['qatar'], en: 'Qatar', fr: 'au Qatar', it: 'in Qatar' },
  { names: ['israel', 'israël', 'israele'], en: 'Israel', fr: 'en Israël', it: 'in Israele' },
  { names: ['lebanon', 'liban', 'libano'], en: 'Lebanon', fr: 'au Liban', it: 'in Libano' },
  { names: ['poland', 'pologne', 'polonia'], en: 'Poland', fr: 'en Pologne', it: 'in Polonia' },
  { names: ['sweden', 'suède', 'suede', 'svezia'], en: 'Sweden', fr: 'en Suède', it: 'in Svezia' },
  { names: ['norway', 'norvège', 'norvege', 'norvegia'], en: 'Norway', fr: 'en Norvège', it: 'in Norvegia' },
  { names: ['denmark', 'danemark', 'danimarca'], en: 'Denmark', fr: 'au Danemark', it: 'in Danimarca' },
  { names: ['finland', 'finlande', 'finlandia'], en: 'Finland', fr: 'en Finlande', it: 'in Finlandia' },
  { names: ['austria', 'autriche'], en: 'Austria', fr: 'en Autriche', it: 'in Austria' },
  { names: ['greece', 'grèce', 'grece', 'grecia'], en: 'Greece', fr: 'en Grèce', it: 'in Grecia' },
  { names: ['hungary', 'hongrie', 'ungheria'], en: 'Hungary', fr: 'en Hongrie', it: 'in Ungheria' },
  { names: ['romania', 'roumanie'], en: 'Romania', fr: 'en Roumanie', it: 'in Romania' },
  { names: ['czech republic', 'czechia', 'tchéquie', 'repubblica ceca'], en: 'the Czech Republic', fr: 'en Tchéquie', it: 'in Repubblica Ceca' },
  { names: ['new zealand', 'nouvelle-zélande', 'nouvelle zélande', 'nuova zelanda'], en: 'New Zealand', fr: 'en Nouvelle-Zélande', it: 'in Nuova Zelanda' },
];

const BY_NAME = new Map<string, Country>(COUNTRIES.flatMap((country) => country.names.map((name) => [name, country] as [string, Country])));
const NAMES = [...BY_NAME.keys()].sort((a, b) => b.length - a.length);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (name: string) => new RegExp(`(^|[^\\p{L}])${escapeRegex(name)}([^\\p{L}]|$)`, 'u');

export const isCountry = (value: string) => BY_NAME.has(value.toLowerCase().trim());
/** Every country name the assistant knows, longest first. */
export const COUNTRY_NAMES = NAMES;

/** The country a text names, as the user wrote it, or ''. */
export function countryIn(text: string) {
  const lower = text.toLowerCase();
  return NAMES.find((name) => wholeWord(name).test(lower)) || '';
}

/** How a place is written: a country gets its proper name, anything else stays as given. */
export function placeName(value: string) {
  return BY_NAME.get(value.toLowerCase().trim())?.en || value;
}

/** "in China" / "en Chine" / "in Cina"; cities take the language's city preposition. */
export function atPlace(language: string, value: string) {
  const country = BY_NAME.get(value.toLowerCase().trim());
  if (language === 'French') return country ? country.fr : `à ${value}`;
  if (language === 'Italian') return country ? country.it : `a ${value}`;
  return `in ${country ? country.en : value}`;
}
