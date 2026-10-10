import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY_OPTIONS, normalizeCity } from '../shared/cities.mjs';

test('CV locations normalize to one city and canonical list values', () => {
  assert.equal(normalizeCity('Zurigo, Svizzera / Amsterdam, Paesi Bassi (o remoto)'), 'Zurich');
  assert.equal(normalizeCity('London, United Kingdom'), 'London');
  assert.equal(normalizeCity('Remote / London'), 'Remote');
  // A leading country is not the city.
  assert.equal(normalizeCity('France, Cergy / Paris / Nantes'), 'Cergy');
  assert.equal(normalizeCity('France (Paris, Nantes)'), 'Paris');
  assert.equal(normalizeCity('Milano, Italia'), 'Milan');
  assert.equal(normalizeCity('France'), 'France');
  assert.ok(CITY_OPTIONS.includes('Remote'));
});
