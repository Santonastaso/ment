import geography from './location-countries.json' with { type: 'json' };

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const countries: Record<string, string> = geography.countries;
const cities: Record<string, string[]> = geography.cities;
const aliases: Record<string, string> = { milano: 'milan', roma: 'rome', zurigo: 'zurich', munchen: 'munich' };

// Many city names exist in several countries (the index lists Paris in four,
// London in three). Left alone, "not in the US" would hide everyone in Paris
// or Rome. The well-known city of a name is the one meant, and the names used
// in French and Italian are read too. Everything else comes from the index.
const PRIMARY: Record<string, string> = Object.fromEntries(Object.entries({
  FR: 'paris|parigi|lyon|lione|marseille|marsiglia|nice|nizza|lille|toulouse|tolosa|bordeaux|nantes|strasbourg|strasburgo|cergy|montpellier|rennes|grenoble',
  GB: 'london|londres|londra|manchester|birmingham|edinburgh|edimbourg|edimburgo|glasgow|cambridge|oxford|bristol|leeds|liverpool|belfast|cardiff',
  IT: 'milan|milano|rome|roma|naples|napoli|turin|torino|florence|firenze|venice|venise|venezia|bologna|bologne|genoa|genova|genes|verona|palermo|padua|padova',
  DE: 'berlin|berlino|munich|munchen|monaco di baviera|frankfurt|francfort|francoforte|hamburg|hambourg|amburgo|cologne|koln|colonia|stuttgart|stoccarda|dusseldorf',
  ES: 'madrid|barcelona|barcelone|barcellona|valencia|seville|sevilla|siviglia|bilbao|malaga',
  CH: 'geneva|geneve|ginevra|zurich|zurigo|lausanne|losanna|basel|bale|basilea|bern|berne|berna|lugano',
  PT: 'lisbon|lisbonne|lisbona|lisboa|porto', IE: 'dublin|dublino', NL: 'amsterdam|rotterdam|the hague|la haye|utrecht|eindhoven',
  BE: 'brussels|bruxelles|antwerp|anvers|anversa|ghent|gand', LU: 'luxembourg|lussemburgo', AT: 'vienna|vienne|wien|salzburg', MC: 'monaco',
  SE: 'stockholm|stoccolma', DK: 'copenhagen|copenhague|copenaghen', NO: 'oslo', FI: 'helsinki', PL: 'warsaw|varsovie|varsavia|krakow',
  CZ: 'prague|praga', HU: 'budapest', GR: 'athens|athenes|atene', TR: 'istanbul', RU: 'moscow|moscou|mosca',
  US: 'new york|new york city|nyc|san francisco|los angeles|boston|chicago|washington|seattle|austin|miami|houston|philadelphia|atlanta',
  CA: 'toronto|montreal|vancouver|ottawa', MX: 'mexico city', BR: 'sao paulo|rio de janeiro', AR: 'buenos aires', CL: 'santiago', CO: 'bogota', PE: 'lima',
  AE: 'dubai|abu dhabi', SG: 'singapore|singapour', HK: 'hong kong', JP: 'tokyo|osaka', KR: 'seoul', CN: 'beijing|pekin|pechino|shanghai|shenzhen',
  IN: 'mumbai|delhi|new delhi|bangalore|bengaluru', AU: 'sydney|melbourne', IL: 'tel aviv', MA: 'rabat|casablanca', TN: 'tunis|tunisi', EG: 'cairo|le caire|il cairo',
  ZA: 'cape town|johannesburg', NG: 'lagos', KE: 'nairobi',
}).flatMap(([code, names]) => names.split('|').map((name) => [name, code])));

// Two-letter codes read a written location ("Paris, US") but are not what
// people type: "not in my field" is not Malaysia. "uk" is the exception.
const typed = (name: string) => name.length > 2 || name === 'uk';
export const COUNTRY_EXCLUSION_NAMES = Object.keys(countries).filter(typed);
export const isCountryExclusion = (place: string) => typed(normalize(place)) && Object.hasOwn(countries, normalize(place));

// Leaving a country out needs evidence of where someone is: a missing or
// unrecognised location is withheld, since it may be in that country. Leaving
// a city out only removes the people known to be there.
export function outsideExcludedPlaces(location: string, excluded: string[], regions: Record<string, string[]>) {
  const parts = normalize(location).split(/\s*[,/;|()]\s*/).filter(Boolean);
  const explicit = parts.map(part => countries[part]).filter(Boolean);
  const codes = explicit.length ? explicit : [...new Set(parts.flatMap(part => PRIMARY[part] ? [PRIMARY[part]] : cities[aliases[part] || part] || []))];
  for (const raw of excluded) {
    const place = normalize(raw);
    const country = typed(place) ? countries[place] : '';
    if (country) {
      if (!codes.length || codes.includes(country)) return false;
    } else {
      const names = [place, ...(regions[raw] || []).map(normalize)];
      if (names.some(name => parts.some(part => (aliases[part] || part) === (aliases[name] || name)))) return false;
    }
  }
  return true;
}
