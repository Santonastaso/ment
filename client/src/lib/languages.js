// `profiles.working_language` stores an ISO code ('en', 'fr'). Codes are the
// right thing to store, but "EN" is not a thing to show a member — resolve them
// to full names in the viewer's own language, so an Italian member reading the
// Explorer filter sees "Inglese" rather than "English" or "EN".

// Intl.DisplayNames covers every ISO code without a lookup table to maintain.
// It throws RangeError on a tag it cannot parse, which is likely here: the
// column is free text with no CHECK constraint, so it can hold anything an
// import put there — including a full name like "English" already.
export function languageName(code, locale = 'en') {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(raw);
    // `fallback: 'code'` hands back the input untouched when it resolves
    // nothing, so only take the result when it actually translated something.
    if (name && name.toLowerCase() !== raw.toLowerCase()) return capitalize(name);
  } catch {
    // Not a parseable language tag — fall through and tidy up the raw value.
  }
  return capitalize(raw);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Options for a language <select>, sorted by what the reader actually sees.
export function languageOptions(codes, locale = 'en') {
  return (codes || [])
    .filter(Boolean)
    .map(code => ({ code, label: languageName(code, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
