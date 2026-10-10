export const CITY_OPTIONS = [
  'Amsterdam', 'Bangalore', 'Barcelona', 'Berlin', 'Boston', 'Brussels', 'Copenhagen',
  'Dubai', 'Dublin', 'Hong Kong', 'Lisbon', 'London', 'Madrid', 'Milan', 'Mumbai',
  'Munich', 'New York', 'Paris', 'Rome', 'San Francisco', 'Seoul', 'Singapore',
  'Stockholm', 'Sydney', 'Tokyo', 'Toronto', 'Zurich', 'Remote',
];

const CITY_ALIASES = { milano: 'Milan', roma: 'Rome', zurigo: 'Zurich', 'zürich': 'Zurich', münchen: 'Munich' };

// A CV often leads with the country ("France, Cergy / Paris / Nantes"): that
// is not a city, so it is only used when nothing else was written.
const COUNTRIES = new Set(['france', 'italy', 'italia', 'italie', 'germany', 'deutschland', 'allemagne', 'germania', 'spain', 'españa',
  'espagne', 'spagna', 'switzerland', 'suisse', 'svizzera', 'schweiz', 'uk', 'united kingdom', 'england', 'royaume-uni', 'regno unito',
  'usa', 'us', 'united states', 'états-unis', 'etats-unis', 'stati uniti', 'netherlands', 'pays-bas', 'paesi bassi', 'belgium', 'belgique',
  'belgio', 'portugal', 'ireland', 'irlande', 'irlanda', 'china', 'chine', 'cina', 'india', 'inde', 'japan', 'japon', 'giappone',
  'canada', 'australia', 'australie', 'brazil', 'brésil', 'brasile', 'europe', 'europa']);

export function normalizeCity(value) {
  const places = String(value || '')
    .split(/\s*(?:\/|;|\||\n|,|\(|\)|\b(?:or|o|ou|et|and|e)\b)\s*/i)
    .map(place => place.trim())
    .filter(Boolean);
  if (!places.length) return '';
  const known = place => CITY_ALIASES[place.toLocaleLowerCase()]
    || CITY_OPTIONS.find(city => city.toLocaleLowerCase() === place.toLocaleLowerCase());
  // The first city written wins; a country only stands in when no city was given.
  const city = places.find(place => !COUNTRIES.has(place.toLocaleLowerCase())) || places[0];
  return known(city) || city;
}
