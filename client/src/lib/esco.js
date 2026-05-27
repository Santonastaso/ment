// Lightweight ESCO autocomplete client.
//
// ESCO's public REST API is CORS-friendly (verified in pre-flight), so we
// hit it directly from the browser. We expose a single `searchEscoSkills`
// helper that:
//   * trims + lowers the query, bails for fewer than 2 meaningful chars
//   * fires up to two language variants in parallel (the user's locale and
//     English) and merges results by ESCO uri
//   * lets the caller pass an AbortSignal so a typing UI can cancel stale
//     in-flight requests
//
// Each returned item is `{ label, uri, language }`. `label` is the ESCO
// preferredLabel in the requested language (falling back to `title`).

const ESCO_BASE = 'https://ec.europa.eu/esco/api/search';
const ALLOWED_LANGS = new Set(['en', 'it', 'fr', 'de', 'es', 'pt', 'nl']);
const FETCH_TIMEOUT_MS = 6000;

function normalizeLang(raw) {
  if (!raw || typeof raw !== 'string') return 'en';
  const base = raw.toLowerCase().split('-')[0];
  return ALLOWED_LANGS.has(base) ? base : 'en';
}

function timeoutSignal(ms, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('esco_timeout')), ms);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

async function searchOne(text, lang, limit, externalSignal) {
  const url = `${ESCO_BASE}?type=skill&language=${encodeURIComponent(lang)}&limit=${limit}&text=${encodeURIComponent(text)}`;
  const { signal, cleanup } = timeoutSignal(FETCH_TIMEOUT_MS, externalSignal);
  try {
    const res = await fetch(url, { method: 'GET', signal, headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const body = await res.json();
    const hits = body?._embedded?.results || [];
    return hits.map((h) => {
      const preferred = h?.preferredLabel?.[lang] || h?.preferredLabel?.en || h?.title || '';
      return {
        label: String(preferred || '').trim(),
        uri: String(h?.uri || ''),
        language: lang,
      };
    }).filter((h) => h.label);
  } catch {
    return [];
  } finally {
    cleanup();
  }
}

// Public: search ESCO. `lang` is normalized; when not English we fan out to
// the user's locale AND English and merge results so a search like
// "gestione" surfaces both Italian and English skill labels.
export async function searchEscoSkills(query, { lang, limit = 6, signal } = {}) {
  const trimmed = (query || '').trim();
  if (trimmed.length < 2) return [];
  const baseLang = normalizeLang(lang);
  const langs = baseLang === 'en' ? ['en'] : [baseLang, 'en'];
  const fanned = await Promise.all(langs.map((l) => searchOne(trimmed, l, limit, signal)));
  const byUri = new Map();
  const byLabel = new Map();
  for (const list of fanned) {
    for (const item of list) {
      const uriKey = item.uri || `__lbl:${item.label.toLowerCase()}`;
      if (byUri.has(uriKey)) continue;
      const labelKey = item.label.toLowerCase();
      if (byLabel.has(labelKey)) continue;
      byUri.set(uriKey, item);
      byLabel.set(labelKey, item);
      if (byUri.size >= limit) break;
    }
    if (byUri.size >= limit) break;
  }
  return Array.from(byUri.values()).slice(0, limit);
}

export function browserLanguage() {
  if (typeof navigator === 'undefined') return 'en';
  return normalizeLang(navigator.language);
}
