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
  'last','next','one','two','three','first','second','third'
]);

const GENERIC_TOKENS = new Set([
  'good','goods','great','bad','well','nice','cool','poor','okay','fine','clean',
  'manage','managing','managed','perform','performing','performed','ensure','ensuring','ensured',
  'develop','developing','developed','make','made','making','take','took','taking',
  'handle','handled','handling','work','worked','working','apply','applied','applying',
  'use','used','using','do','done',
  'general','overall','various','several',
  'help','helped','helping','went','run','ran','running','put','tried','try','keep','kept',
  'feel','felt','feeling','think','thought','thinking','say','said','saying','tell','told','telling',
  'find','found','finding','show','showed','showing','give','gave','giving','get','got','getting',
  'quick','quickly','slow','slowly','test','testing','tested',
  'team','teams','people','person','colleague','colleagues','member','members',
  'project','projects','meeting','meetings','session','sessions',
  'something','someone','everything','everyone','anything','anyone',
  'setup','setups','lost','shipped','built','wrote','spent','ran','went',
  'draw','drawn','article','articles','instrument','instruments','vessel','vessels',
  'support','process','system','service','services','operation','operations',
]);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
}

function meaningfulTokens(text) {
  return tokenize(text).filter(t => t.length >= 4 && !STOP_WORDS.has(t));
}

function nonGenericTokens(text) {
  return meaningfulTokens(text).filter(t => !GENERIC_TOKENS.has(t));
}

function escoRelevantToInput(label, inputText) {
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

function isAcceptableCanonicalization(phrase, label) {
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
const escoCache = new Map();
const ESCO_TTL_MS = 10 * 60 * 1000;

async function escoExtract(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const query = trimmed.slice(0, 500);

  const cached = escoCache.get(query);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = `${ESCO_BASE}?type=skill&language=en&limit=${ESCO_LIMIT}&text=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ESCO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hits = data?._embedded?.results || [];
    const out = hits
      .map(h => ({
        label: h.title || h.preferredLabel?.en || h.preferredLabel?.['en-us'] || '',
        uri: h.uri || '',
      }))
      .filter(x => x.label);

    escoCache.set(query, { value: out, expiresAt: Date.now() + ESCO_TTL_MS });
    return out;
  } catch {
    return null;
  }
}

async function canonicalizePhrase(phrase, contextText = '') {
  const useEsco = process.env.MENT_DISABLE_ESCO !== '1';
  if (!useEsco) return { label: phrase, uri: '' };
  const r = await escoExtract(phrase);
  for (const candidate of (r || [])) {
    if (isAcceptableCanonicalization(phrase, candidate.label) &&
        escoRelevantToInput(candidate.label, contextText + ' ' + phrase)) {
      return candidate;
    }
  }
  return { label: phrase, uri: '' };
}

module.exports = {
  escoExtract,
  escoRelevantToInput,
  isAcceptableCanonicalization,
  canonicalizePhrase,
  meaningfulTokens,
  nonGenericTokens,
};
