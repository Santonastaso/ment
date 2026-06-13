#!/usr/bin/env node
// Audits the i18n catalogs and reports any key present in one locale but
// missing in the other. Exit code 1 if gaps are found (suitable for CI).
//
// Usage: node scripts/check-i18n-coverage.mjs [--fix-empty]
// With --fix-empty, missing keys are inserted into the target locale with an
// empty string so a human can later fill them in (still exits 1 to flag).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOCALES_DIR = path.join(ROOT, 'client/src/i18n/locales');
const LOCALES = ['en', 'it'];
const FIX_EMPTY = process.argv.includes('--fix-empty');

function loadLocaleNamespace(locale, ns) {
  const file = path.join(LOCALES_DIR, locale, `${ns}.json`);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  const en = loadLocaleNamespace('en', ns);
  const it = loadLocaleNamespace('it', ns);
  const enKeys = new Set(Object.keys(en));
  const itKeys = new Set(Object.keys(it));
  const onlyEn = [...enKeys].filter(k => !itKeys.has(k));
  const onlyIt = [...itKeys].filter(k => !enKeys.has(k));
  return { en, it, onlyEn, onlyIt };
}

function writeFixed(locale, ns, obj) {
  const file = path.join(LOCALES_DIR, locale, `${ns}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

let totalGaps = 0;
const namespaces = listNamespaces();
for (const ns of namespaces) {
  const { en, it, onlyEn, onlyIt } = diffNamespace(ns);
  if (onlyEn.length === 0 && onlyIt.length === 0) continue;
  console.log(`\n[${ns}.json]`);
  if (onlyEn.length) {
    console.log(`  Missing in it/ (${onlyEn.length}):`);
    for (const k of onlyEn) console.log(`    - ${k} = ${JSON.stringify(en[k])}`);
    if (FIX_EMPTY) {
      const merged = { ...it };
      for (const k of onlyEn) merged[k] = '';
      writeFixed('it', ns, merged);
      console.log('    -> inserted empty placeholders in it/' + ns + '.json');
    }
  }
  if (onlyIt.length) {
    console.log(`  Missing in en/ (${onlyIt.length}):`);
    for (const k of onlyIt) console.log(`    - ${k}`);
    if (FIX_EMPTY) {
      const merged = { ...en };
      for (const k of onlyIt) merged[k] = it[k];
      writeFixed('en', ns, merged);
      console.log('    -> copied IT value as placeholder into en/' + ns + '.json');
    }
  }
  totalGaps += onlyEn.length + onlyIt.length;
}

if (totalGaps === 0) {
  console.log('All i18n catalogs match — no missing keys.');
  process.exit(0);
} else {
  console.log(`\n${totalGaps} missing key${totalGaps === 1 ? '' : 's'}. ` +
              (FIX_EMPTY ? 'Empty placeholders inserted — fill them in.' : 'Re-run with --fix-empty to scaffold placeholders.'));
  process.exit(1);
}
