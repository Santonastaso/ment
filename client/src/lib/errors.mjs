// What to show a person when a request fails.
//
// The data layer's errors keep their machine-readable code and status: retry
// logic and onboarding read them, so they are never rewritten. This turns a
// code into a sentence for display. A code with a translation gets it; anything
// else (an unknown code, a dropped connection) gets the caller's fallback, so
// "TypeError: Failed to fetch" or `idempotency_conflict` never reach the screen.
// Only the code and status are logged, never what was being sent.
export function errorMessage(error, t, fallback) {
  const code = error?.response?.data?.error;
  if (typeof code === 'string' && /^[a-z][a-z0-9_]*$/.test(code)) {
    const key = `errors.${code}`;
    const text = t(key);
    if (text && text !== key) return text;
  }
  if (typeof console !== 'undefined') console.warn('[ment] request failed', { code: typeof code === 'string' ? code.slice(0, 80) : undefined, status: error?.response?.status });
  return fallback;
}
