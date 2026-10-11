import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { build } = createRequire(new URL('../client/package.json', import.meta.url))('esbuild');
const compiled = await build({ entryPoints: ['supabase/functions/discovery-assistant/location-exclusions.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { outsideExcludedPlaces: outside, isCountryExclusion } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('country exclusions use geography, aliases and conservative unknown handling', () => {
  for (const [location, country] of [['Lyon', 'France'], ['Marseille', 'france'], ['Naples', 'Italia'], ['Manchester', 'UK'], ['Tokyo', 'Japon']]) {
    assert.equal(outside(location, [country], {}), false, location);
  }
  assert.equal(outside('Berlin', ['France'], {}), true);
  assert.equal(outside('Paris, US', ['France'], {}), true);
  assert.equal(outside('Unmapped village', ['France'], {}), false);
  assert.equal(outside('', ['France'], {}), false);
  assert.equal(outside('Londonderry', ['London'], {}), true);
  assert.equal(outside('Milano', ['Milan'], {}), false);
  assert.equal(isCountryExclusion('UK'), true);
});

test('a shared city name means the well-known city, and unknown places are only withheld for countries', () => {
  // Paris, London, Rome and Berlin all have namesakes in the United States.
  for (const city of ['Paris', 'London', 'Rome', 'Berlin', 'Madrid', 'Vienna', 'Londres', 'Parigi', 'Milano']) assert.equal(outside(city, ['USA'], {}), true, city);
  for (const city of ['New York', 'San Francisco', 'Denver', 'Chicago']) assert.equal(outside(city, ['usa'], {}), false, city);
  assert.equal(outside('Londra', ['uk'], {}), false);
  assert.equal(outside('London, UK', ['uk'], {}), false);
  // A written country settles it, whatever the city is called.
  assert.equal(outside('Paris, US', ['usa'], {}), false);
  // Leaving out a city says nothing about people whose location is unknown.
  assert.equal(outside('', ['London'], {}), true);
  assert.equal(outside('Unmapped village', ['London'], {}), true);
  assert.equal(outside('London', ['London'], {}), false);
  // A region is its listed cities.
  assert.equal(outside('Paris', ['europe'], { europe: ['Paris', 'Berlin'] }), false);
  assert.equal(outside('Tokyo', ['europe'], { europe: ['Paris', 'Berlin'] }), true);
  // Two-letter codes are not names people type.
  for (const word of ['my', 'it', 'in', 'no', 'ma', 'sa', 'us']) assert.equal(isCountryExclusion(word), false, word);
});
