// Shared ESCO + tokenization helpers (Deno port of server/utils/esco.js)

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','is','was','were','be','been','being',
  'have','has','had','having','do','does','did','doing','going','gonna',
  'i','we','you','they','it','he','she','my','our','your','their','me','us','them','his','her','its',
  'on','in','at','to','of','for','with','as','by','from','into','about','against','between','through','during','over','under',
  'this','that','these','those','what','which','who','whom','when','where','why','how',
  'so','too','very','really','just','quite','pretty','kind','sort','more','most','some','any','no','not','none','nothing','nobody',
  'all','every','each','few','many','much','such','same','other','another','rather','almost',
  'today','tomorrow','yesterday','week','month','year','day','time','thing','stuff','lot','bit','part','place',
  'note','notes','here','there','also','still','only','even','again','always','never','ever',
  'will','would','can','could','should','might','may','must','shall','need','want','wanted',
  'am','are','being',"don't","didn't","wasn't","aren't","isn't","won't","can't","couldn't","wouldn't","shouldn't",
  'last','next','one','two','three','first','second','third',
]);

const GENERIC_TOKENS = new Set([
  'good','goods','great','bad','well','nice','cool','poor','okay','fine','clean',
  'manage','managing','managed','perform','performing','performed','ensure','ensuring','ensured',
  'develop','developing','developed','make','made','making','take','took','taking',
  'handle','handled','handling','work','worked','working','apply','applied','applying',
  'use','used','using','do','done','general','overall','various','several',
  'help','helped','helping','went','run','ran','running','put','tried','try','keep','kept',
  'feel','felt','feeling','think','thought','thinking','say','said','saying','tell','told','telling',
  'find','found','finding','show','showed','showing','give','gave','giving','get','got','getting',
  'quick','quickly','slow','slowly','test','testing','tested',
  'team','teams','people','person','colleague','colleagues','member','members',
  'project','projects','meeting','meetings','session','sessions',
  'something','someone','everything','everyone','anything','anyone',
  'setup','setups','lost','shipped','built','wrote','spent',
  'support','process','system','service','services','operation','operations',
]);

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenize(text: string): string[] {
  if (!text) return [];
  return text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [];
}

export function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}

export function nonGenericTokens(text: string): string[] {
  return meaningfulTokens(text).filter((t) => !GENERIC_TOKENS.has(t));
}

export function isSubstantive(text: string): boolean {
  return nonGenericTokens(text).length >= 2;
}

export function escoRelevantToInput(label: string, inputText: string): boolean {
  const labelTokens = nonGenericTokens(label);
  if (labelTokens.length === 0) return false;
  const inputTokens = new Set(meaningfulTokens(inputText));
  for (const t of labelTokens) {
    if (inputTokens.has(t)) return true;
    const prefix = t.slice(0, 5);
    for (const it of inputTokens) {
      if (it === t) return true;
      if (it.length >= 4 && prefix.length >= 4 &&
          (it.startsWith(prefix) || prefix.startsWith(it.slice(0, 5)))) {
        return true;
      }
    }
  }
  return false;
}

export function isAcceptableCanonicalization(phrase: string, label: string): boolean {
  if (!label || !phrase) return false;
  const p = phrase.toLowerCase().trim();
  const l = label.toLowerCase().trim();
  if (l === p) return true;
  const re = new RegExp(`\\b${escapeRe(p)}\\b`, 'i');
  if (!re.test(l)) return false;
  const pWords = p.split(/\s+/).length;
  const lWords = l.split(/\s+/).length;
  if (pWords === 1 && lWords > 3) return false;
  if (pWords === 2 && lWords > 4) return false;
  if (pWords >= 3 && lWords > pWords + 2) return false;
  return true;
}

const ESCO_BASE = 'https://ec.europa.eu/esco/api/search';
const ESCO_TIMEOUT_MS = 8000;
const ESCO_LIMIT = 5;
const ESCO_ALLOWED_LANGS = new Set(['en', 'it', 'fr', 'de', 'es', 'pt', 'nl']);

export type EscoHit = { label: string; uri: string };

export function normalizeLang(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return 'en';
  const base = raw.toLowerCase().split('-')[0];
  return ESCO_ALLOWED_LANGS.has(base) ? base : 'en';
}

async function escoExtractSingle(text: string, lang: string): Promise<EscoHit[] | null> {
  const query = text.slice(0, 500);
  const url = `${ESCO_BASE}?type=skill&language=${encodeURIComponent(lang)}&limit=${ESCO_LIMIT}&text=${encodeURIComponent(query)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ESCO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      // ec.europa.eu serves Brotli-compressed responses. Force identity
      // encoding so Deno's fetch body reader doesn't choke on the stream.
      // (`res.json()` was failing inside Supabase Edge Functions with
      // "error reading a body from connection".)
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : null;
    const hits = data?._embedded?.results ?? [];
    return hits
      .map((h: Record<string, unknown>) => {
        const pref = (h.preferredLabel as Record<string, string>) || {};
        const label = pref[lang] || pref.en || pref['en-us'] || (h.title as string) || '';
        return { label, uri: (h.uri as string) || '' };
      })
      .filter((x: EscoHit) => x.label);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Extract ESCO skill hits for `text`. When `lang` differs from English, we
// fan out two parallel queries (locale + English) and merge results,
// deduping by uri then by lowercased label. Returns null only when the
// underlying fetch fails outright; an empty result returns [].
export async function escoExtract(text: string, lang?: string): Promise<EscoHit[] | null> {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const baseLang = normalizeLang(lang);
  const langs = baseLang === 'en' ? ['en'] : [baseLang, 'en'];
  const results = await Promise.all(langs.map((l) => escoExtractSingle(trimmed, l)));
  // If all results are null, treat as a failure so the caller can fall back.
  if (results.every((r) => r === null)) return null;

  const byUri = new Map<string, EscoHit>();
  const byLabel = new Map<string, EscoHit>();
  for (const list of results) {
    if (!list) continue;
    for (const item of list) {
      const uriKey = item.uri || `__lbl:${item.label.toLowerCase()}`;
      if (byUri.has(uriKey)) continue;
      const labelKey = item.label.toLowerCase();
      if (byLabel.has(labelKey)) continue;
      byUri.set(uriKey, item);
      byLabel.set(labelKey, item);
      if (byUri.size >= ESCO_LIMIT) break;
    }
    if (byUri.size >= ESCO_LIMIT) break;
  }
  return Array.from(byUri.values()).slice(0, ESCO_LIMIT);
}
