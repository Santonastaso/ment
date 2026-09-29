#!/usr/bin/env node
// Audits the i18n catalogs and reports any key present in one locale but
// missing in another. Exit code 1 if gaps are found (suitable for CI).
//
// Usage: node scripts/check-i18n-coverage.mjs [--fix-empty] [--strict-translations]
// With --fix-empty, missing keys are inserted into the target locale as empty
// strings so a human can later fill them in (still exits 1 to flag).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOCALES_DIR = path.join(ROOT, 'client/src/i18n/locales');
const REFERENCE_LOCALE = 'en';
const LOCALES = fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort((a, b) => (a === REFERENCE_LOCALE ? -1 : b === REFERENCE_LOCALE ? 1 : a.localeCompare(b)));
const FIX_EMPTY = process.argv.includes('--fix-empty');
const STRICT_TRANSLATIONS = process.argv.includes('--strict-translations');

function loadLocaleNamespace(locale, ns) {
  const file = path.join(LOCALES_DIR, locale, `${ns}.json`);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function listNamespaces() {
  const seen = new Set();
  for (const locale of LOCALES) {
    const dir = path.join(LOCALES_DIR, locale);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) seen.add(f.replace(/\.json$/, ''));
    }
  }
  return [...seen].sort();
}

function diffNamespace(ns) {
  const catalogs = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocaleNamespace(locale, ns)]));
  const allKeys = new Set(Object.values(catalogs).flatMap((catalog) => Object.keys(catalog)));
  const missing = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      [...allKeys].filter((key) => !(key in catalogs[locale])),
    ])
  );
  return { catalogs, missing };
}

function writeFixed(locale, ns, obj) {
  const file = path.join(LOCALES_DIR, locale, `${ns}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

let totalGaps = 0;
const namespaces = listNamespaces();
for (const ns of namespaces) {
  const { catalogs, missing } = diffNamespace(ns);
  const missingLocales = LOCALES.filter((locale) => missing[locale].length > 0);
  if (missingLocales.length === 0) continue;
  console.log(`\n[${ns}.json]`);
  for (const locale of missingLocales) {
    console.log(`  Missing in ${locale}/ (${missing[locale].length}):`);
    for (const k of missing[locale]) console.log(`    - ${k} = ${JSON.stringify(catalogs[REFERENCE_LOCALE]?.[k] ?? '')}`);
    if (FIX_EMPTY) {
      const merged = { ...catalogs[locale] };
      for (const k of missing[locale]) merged[k] = '';
      writeFixed(locale, ns, merged);
      console.log(`    -> inserted empty placeholders in ${locale}/${ns}.json`);
    }
  }
  totalGaps += missingLocales.reduce((sum, locale) => sum + missing[locale].length, 0);
}

if (totalGaps === 0) {
  console.log('All i18n catalogs match — no missing keys.');
} else {
  console.log(`\n${totalGaps} missing key${totalGaps === 1 ? '' : 's'}. ` +
              (FIX_EMPTY ? 'Empty placeholders inserted — fill them in.' : 'Re-run with --fix-empty to scaffold placeholders.'));
}

// ---- Second pass: keys referenced via t('...') in source must exist in BOTH
// locales. Catches keys missing from every catalog (parity alone can't).
function collectUsedKeys(dir, out = new Set()) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) collectUsedKeys(p, out);
    else if (/\.(jsx?|tsx?)$/.test(f.name)) {
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
    }
  }
  return out;
}

const allKeys = new Set();
for (const ns of namespaces) {
  const reference = loadLocaleNamespace(REFERENCE_LOCALE, ns);
  for (const k of Object.keys(reference)) allKeys.add(k);
}
const usedKeys = collectUsedKeys(path.join(ROOT, 'client/src'));
// Dynamic keys (template literals like `tier${x}`) aren't captured by the regex;
// ignore anything that doesn't literally exist as a t('...') string.
const dangling = [...usedKeys].filter(k => !allKeys.has(k)).sort();

let usageGaps = 0;
if (dangling.length) {
  console.log(`\nKeys used in source but missing from ALL en catalogs (${dangling.length}):`);
  for (const k of dangling) console.log(`  - ${k}`);
  usageGaps = dangling.length;
}

let formatGaps = 0;
let untranslated = 0;
const placeholders = (value) => [...value.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)]
  .map((match) => match[1]).sort().join(',');
for (const ns of namespaces) {
  const reference = loadLocaleNamespace(REFERENCE_LOCALE, ns);
  for (const locale of LOCALES.filter((name) => name !== REFERENCE_LOCALE)) {
    const catalog = loadLocaleNamespace(locale, ns);
    const carryovers = [];
    for (const [key, source] of Object.entries(reference)) {
      const translated = catalog[key];
      if (typeof source !== 'string' || typeof translated !== 'string') continue;
      if (!translated.trim() || (source.length > 15 && translated === source)) carryovers.push(key);
      if (/\{\{\w+\}\}/.test(translated) || placeholders(source) !== placeholders(translated)) {
        console.error(`Invalid interpolation in ${locale}/${ns}.json: ${key}`);
        formatGaps++;
      }
    }
    if (carryovers.length) {
      untranslated += carryovers.length;
      console.log(`${locale}/${ns}.json: ${carryovers.length} blank or unchanged English values`);
      if (STRICT_TRANSLATIONS) console.log(`  ${carryovers.join(', ')}`);
    }
  }
}

if (untranslated) console.log(`${untranslated} translations need human review (some unchanged proper names may be intentional).`);
if (totalGaps === 0 && usageGaps === 0 && formatGaps === 0 && (!STRICT_TRANSLATIONS || untranslated === 0)) {
  process.exit(0);
}
process.exit(1);

