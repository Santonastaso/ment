const db = require('../db/database');

// ----------------------------------------------------------------------------
// Matching strategy (read this if you're tuning the classifier):
//
//   1. Quality gate. Reflection text is split into "meaningful" tokens
//      (4+ chars, not in stop/generic word lists). If the text has fewer than
//      2 meaningful tokens, no skills are extracted at all. This stops noise
//      like "All good." or "Quick test note." from producing suggestions.
//
//   2. ESCO direct query. The full text is sent to ESCO. Each ESCO candidate
//      is then put through a *critical relevance filter*: it must share at
//      least one **non-generic** token with the input. Generic tokens like
//      `good`, `goods`, `manage`, `perform`, `ensure`, `develop`, `quick`,
//      `test`, etc. are excluded so a phrase like "monitor goods movement"
//      cannot survive on the back of "All good."
//
//   3. Heuristic fallback. If no ESCO candidates pass the filter (network
//      failure, only-generic matches, low-quality input), we run a curated
//      vocabulary match. Each surviving phrase may then be canonicalized via
//      ESCO if a *relevant* hit is available; otherwise the original phrase
//      stays.
//
//   4. Optional Claude pre-pass. When ANTHROPIC_API_KEY is present, Claude
//      Haiku extracts candidate skill phrases first, then each is run through
//      the same ESCO + relevance pipeline.
// ----------------------------------------------------------------------------

// Curated baseline so the heuristic fallback works without DB content.
const CURATED = [
  'leadership','mentoring','communication','presentation skills','time management','public speaking',
  'data analysis','strategic thinking','negotiation','project management','program management',
  'React','TypeScript','JavaScript','Python','SQL','system design','code review','testing strategy',
  'API design','observability','DevOps','Docker','Kubernetes',
  'budgeting','forecasting','financial modeling','financial analysis','Excel','compliance','risk management',
  'SEO','content strategy','copywriting','analytics','growth marketing','social media','brand storytelling',
  'process optimization','vendor management','supply chain','procurement','operations analytics','change management',
  'product strategy','user research','UX research','roadmapping','prioritization','PRD writing','stakeholder management',
  'design systems','prototyping','usability testing','accessibility',
  'recruiting','interviewing','people management','coaching','performance management','onboarding','DEI',
  'contract drafting','privacy','legal research',
  'discovery calls','pipeline management','enterprise sales','SaaS sales','solution selling',
  'customer health','renewal strategy','expansion','escalation management',
];

function buildVocab() {
  const set = new Set(CURATED);
  try {
    for (const r of db.prepare('SELECT DISTINCT skill FROM skills').all()) {
      if (r.skill && r.skill.trim()) set.add(r.skill.trim());
    }
  } catch { /* schema not ready */ }
  return [...set];
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Words excluded from "meaningful token" counting and overlap matching.
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

// Tokens that can appear in many ESCO labels but signal *no* concrete skill on their own.
// A candidate label needs to share at least one NON-generic token with the input
// before we accept it.
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

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
}

// "Meaningful" = at least 4 chars and not a stop word
function meaningfulTokens(text) {
  return tokenize(text).filter(t => t.length >= 4 && !STOP_WORDS.has(t));
}

// "Non-generic" = meaningful AND not in the generic-tokens list (the part
// that decides whether a candidate is actually about something)
function nonGenericTokens(text) {
  return meaningfulTokens(text).filter(t => !GENERIC_TOKENS.has(t));
}

// Does the user's text describe anything substantive enough to classify?
function isSubstantive(text) {
  return nonGenericTokens(text).length >= 2;
}

// Critical relevance check for an ESCO candidate vs. the original input.
// Requires at least one non-generic token from the candidate label to appear
// in the input (with a small allowance for plural / -ing variants).
function escoRelevantToInput(label, inputText) {
  const labelTokens = nonGenericTokens(label);
  if (labelTokens.length === 0) return false;
  const inputTokens = new Set(meaningfulTokens(inputText));
  for (const t of labelTokens) {
    if (inputTokens.has(t)) return true;
    // crude stem matching: same 5-char prefix, similar length
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

// When canonicalizing a heuristic phrase via ESCO, only accept the ESCO label
// if it's a credible expansion of the *same* skill — i.e. it contains the
// original phrase as a substring AND isn't dramatically longer.
// This stops ESCO from substituting "React" with "react to emergency
// situations in a live performance environment", or "procurement" with
// "coordinate the procurement of organs for transplantation".
function isAcceptableCanonicalization(phrase, label) {
  if (!label || !phrase) return false;
  const p = phrase.toLowerCase().trim();
  const l = label.toLowerCase().trim();
  if (l === p) return true;
  // Must contain the original phrase as a whole-word substring
  const re = new RegExp(`\\b${escapeRe(p)}\\b`, 'i');
  if (!re.test(l)) return false;
  const pWords = p.split(/\s+/).length;
  const lWords = l.split(/\s+/).length;
  // Length sanity:
  //   1-word phrase  → label may have at most 3 words (e.g. "Python (computer programming)")
  //   2-word phrase  → label may have at most 4 words
  //   longer phrases → label may be at most 2 words longer than the phrase
  if (pWords === 1 && lWords > 3) return false;
  if (pWords === 2 && lWords > 4) return false;
  if (pWords >= 3 && lWords > pWords + 2) return false;
  return true;
}

function heuristicMatch(text, vocab) {
  if (!text || !text.trim()) return [];
  const sorted = [...vocab].sort((a, b) => b.length - a.length);
  const lc = text.toLowerCase();
  const consumed = Array.from(lc, () => false);
  const out = [];
  const seen = new Set();
  for (const skill of sorted) {
    if (seen.has(skill.toLowerCase())) continue;
    const re = new RegExp(`\\b${escapeRe(skill.toLowerCase())}\\b`, 'g');
    let m;
    while ((m = re.exec(lc)) !== null) {
      const overlaps = consumed.slice(m.index, m.index + skill.length).some(Boolean);
      if (!overlaps) {
        out.push(skill);
        seen.add(skill.toLowerCase());
        for (let i = m.index; i < m.index + skill.length; i++) consumed[i] = true;
        break;
      }
    }
  }
  return out.slice(0, 6);
}

// ---------- ESCO ----------
// Public, no-auth REST endpoint maintained by the European Commission.
// We send the full reflection text and ESCO returns the closest matching skills
// from its standardized taxonomy (English skill set). Each result is a
// canonical skill with a stable URI and a preferred label.
const ESCO_BASE = 'https://ec.europa.eu/esco/api/search';
const ESCO_TIMEOUT_MS = 8000;
const ESCO_LIMIT = 5;

// Tiny in-memory cache so repeated identical queries during a session don't re-hit the API
const escoCache = new Map();
const ESCO_TTL_MS = 10 * 60 * 1000;

async function escoExtract(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  // ESCO seems to perform best on a tightly scoped query, so cap the input length
  const query = trimmed.slice(0, 500);

  const cached = escoCache.get(query);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = `${ESCO_BASE}?type=skill&language=en&limit=${ESCO_LIMIT}&text=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
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

// ---------- Optional Claude pre-extraction ----------
// If ANTHROPIC_API_KEY is set we ask Claude Haiku 4.5 to pull candidate skill
// phrases first, then route each through ESCO for canonicalization. This
// generally produces tighter, more specific matches.
async function claudeExtractCandidates({ supportNeeded, managedWell }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt =
    'You read short employee weekly check-ins and extract skill phrases.\n' +
    'Output ONLY a JSON object with two arrays:\n' +
    '  {"gaps": string[], "strengths": string[]}\n' +
    'gaps   = skills the person felt they needed support on this week (max 5).\n' +
    'strengths = skills they felt they handled well this week (max 5).\n' +
    'Each entry should be a short, standardized professional skill phrase ' +
    '(e.g. "stakeholder management", "React", "financial modeling"). Return [] if nothing relevant.';

  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ],
    messages: [{
      role: 'user',
      content: 'Support needed:\n' + (supportNeeded || '(none)') +
               '\n\nManaged well:\n' + (managedWell || '(none)')
    }]
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter(Boolean).slice(0, 5) : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter(Boolean).slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

// Run the full extraction pipeline on a single text block.
// Heuristic-first: the curated skill vocabulary is the primary anchor — if it
// matches anything, those phrases (canonicalized via ESCO when possible) win.
// ESCO direct is only used as a discovery fallback when the user wrote about
// something the vocabulary doesn't cover.
// Returns { pairs, usedEsco, usedHeuristic }
async function classifyOneText(text, vocab, useEsco) {
  // Quality gate: refuse to classify text without enough substance
  if (!isSubstantive(text)) {
    return { pairs: [], usedEsco: false, usedHeuristic: false };
  }

  const heuristicHits = heuristicMatch(text, vocab);

  // Primary path: vocabulary anchor → ESCO canonicalization (per phrase, with
  // a tight acceptance rule so weird ESCO labels don't replace the original).
  if (heuristicHits.length > 0) {
    if (useEsco) {
      const enriched = await Promise.all(
        heuristicHits.map(async (phrase) => {
          const r = await escoExtract(phrase);
          for (const candidate of (r || [])) {
            if (isAcceptableCanonicalization(phrase, candidate.label)) {
              return candidate;
            }
          }
          return { label: phrase, uri: '' };
        })
      );
      return {
        pairs: enriched.slice(0, 5),
        usedEsco: enriched.some(p => p.uri),
        usedHeuristic: true,
      };
    }
    return {
      pairs: heuristicHits.slice(0, 5).map(label => ({ label, uri: '' })),
      usedEsco: false,
      usedHeuristic: true,
    };
  }

  // Discovery fallback: ESCO direct on the full text, but with a *strict*
  // relevance filter so generic tokens (good, manage, setup, etc.) can't carry
  // a candidate through.
  if (useEsco) {
    const escoHits = await escoExtract(text);
    if (Array.isArray(escoHits) && escoHits.length > 0) {
      const relevant = escoHits.filter(h => escoRelevantToInput(h.label, text));
      if (relevant.length > 0) {
        return { pairs: relevant.slice(0, 5), usedEsco: true, usedHeuristic: false };
      }
    }
  }

  return { pairs: [], usedEsco: false, usedHeuristic: false };
}

// Run a Claude pre-pass over both texts, then route each candidate through ESCO
async function classifyViaClaude({ supportNeeded, managedWell }, useEsco) {
  const claude = await claudeExtractCandidates({ supportNeeded, managedWell });
  if (!claude) return null;

  const canonicalize = async (phrase, inputContext) => {
    if (!useEsco) return { label: phrase, uri: '' };
    const r = await escoExtract(phrase);
    const top = r?.[0];
    if (top && escoRelevantToInput(top.label, inputContext + ' ' + phrase)) {
      return top;
    }
    return { label: phrase, uri: '' };
  };

  const gapPairs = await Promise.all(claude.gaps.map(p => canonicalize(p, supportNeeded)));
  const strengthPairs = await Promise.all(claude.strengths.map(p => canonicalize(p, managedWell)));
  return {
    gapPairs,
    strengthPairs,
    source: useEsco ? 'claude-haiku-4-5+esco' : 'claude-haiku-4-5',
  };
}

// ---------- Top-level classifier ----------
async function classifyReflection({ supportNeeded, managedWell }) {
  const useEsco = process.env.MENT_DISABLE_ESCO !== '1';
  const vocab = buildVocab();

  // Optional Path A — Claude extracts, ESCO canonicalizes (only when API key is set)
  const claude = await classifyViaClaude({ supportNeeded, managedWell }, useEsco);
  if (claude) {
    return shape(claude.gapPairs, claude.strengthPairs, claude.source);
  }

  // Path B — ESCO direct + relevance filter, with heuristic fallback per text
  const [g, s] = await Promise.all([
    classifyOneText(supportNeeded, vocab, useEsco),
    classifyOneText(managedWell, vocab, useEsco),
  ]);

  const usedEsco = g.usedEsco || s.usedEsco;
  const usedHeuristic = g.usedHeuristic || s.usedHeuristic;
  const source = usedEsco && usedHeuristic ? 'esco+heuristic'
               : usedEsco ? 'esco'
               : usedHeuristic ? 'heuristic'
               : 'esco';   // nothing extracted — record the engine we tried

  return shape(g.pairs, s.pairs, source);
}

function shape(gapPairs, strengthPairs, source) {
  // Deduplicate by lowercase label so we never store the same phrase twice
  const dedup = pairs => {
    const seen = new Set();
    const out = [];
    for (const p of pairs) {
      const key = (p.label || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  };
  const gaps = dedup(gapPairs);
  const strengths = dedup(strengthPairs);
  const uris = {};
  for (const p of [...gaps, ...strengths]) {
    if (p.uri) uris[p.label] = p.uri;
  }
  return {
    gaps: gaps.map(p => p.label),
    strengths: strengths.map(p => p.label),
    esco_uris: uris,
    source,
  };
}

module.exports = { classifyReflection };
