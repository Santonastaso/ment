export const CITY_OPTIONS = [
  'Amsterdam', 'Bangalore', 'Barcelona', 'Berlin', 'Boston', 'Brussels', 'Copenhagen',
  'Dubai', 'Dublin', 'Hong Kong', 'Lisbon', 'London', 'Madrid', 'Milan', 'Mumbai',
  'Munich', 'New York', 'Paris', 'Rome', 'San Francisco', 'Seoul', 'Singapore',
  'Stockholm', 'Sydney', 'Tokyo', 'Toronto', 'Zurich', 'Remote',
];

const CITY_ALIASES = { milano: 'Milan', roma: 'Rome', zurigo: 'Zurich', 'zürich': 'Zurich', münchen: 'Munich' };

export function normalizeCity(value) {
  const firstPlace = String(value || '')
    .split(/\s*(?:\/|;|\||\n|\b(?:or|o)\b)\s*/i)[0]
    .split(',')[0]
    .replace(/\s*\([^)]*\)\s*/g, '')
    .trim();
  if (!firstPlace) return '';
  return CITY_ALIASES[firstPlace.toLocaleLowerCase()]
    || CITY_OPTIONS.find(city => city.toLocaleLowerCase() === firstPlace.toLocaleLowerCase())
    || firstPlace;
}
