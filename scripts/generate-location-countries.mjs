// Reproducible, offline runtime index from the pinned GeoNames-derived dataset.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const rows = require('cities.json');
const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const cities = {};
for (const row of rows) {
  const name = normalize(row.name);
  (cities[name] ||= new Set()).add(row.country);
}
const countries = {};
for (const code of new Set(rows.map(row => row.country))) {
  countries[code.toLowerCase()] = code;
  for (const lang of ['en', 'fr', 'it']) {
    countries[normalize(new Intl.DisplayNames([lang], { type: 'region' }).of(code))] = code;
  }
}
Object.assign(countries, { uk: 'GB', england: 'GB', britain: 'GB', usa: 'US', 'stati uniti': 'US', holland: 'NL' });
const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b, 'en')));
const data = { countries: sorted(countries), cities: sorted(Object.fromEntries(Object.entries(cities).map(([name, codes]) => [name, [...codes].sort()]))) };
writeFileSync(new URL('../supabase/functions/discovery-assistant/location-countries.json', import.meta.url), JSON.stringify(data) + '\n');
