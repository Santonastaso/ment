// Reflection classifier (Deno port of server/utils/reflectionClassifier.js).
// Body: { reflection_log_id: number }
// Reads the log, runs the same Claude+ESCO+heuristic pipeline, writes
// extracted_gaps/extracted_strengths/esco_uris back. Returns the same shape
// the legacy classifier returned.

import {
  corsHeaders,
  jsonError,
  jsonOk,
  requireUser,
} from '../_shared/index.ts';
import {
  escoExtract,
  escoRelevantToInput,
  isAcceptableCanonicalization,
  isSubstantive,
} from '../_shared/esco.ts';

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

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function heuristicMatch(text: string): string[] {
  if (!text || !text.trim()) return [];
  const sorted = [...CURATED].sort((a, b) => b.length - a.length);
  const lc = text.toLowerCase();
  const consumed = Array.from(lc, () => false);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const skill of sorted) {
    if (seen.has(skill.toLowerCase())) continue;
    const re = new RegExp(`\\b${escapeRe(skill.toLowerCase())}\\b`, 'g');
    let m: RegExpExecArray | null;
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

async function claudeExtractCandidates(supportNeeded: string, managedWell: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;

  const systemPrompt =
    'You read short employee weekly check-ins and extract skill phrases.\n' +
    'Output ONLY a JSON object with two arrays:\n' +
    '  {"gaps": string[], "strengths": string[]}\n' +
    'gaps = skills the person felt they needed support on this week (max 5).\n' +
    'strengths = skills they felt they handled well this week (max 5).\n' +
    'Each entry should be a short, standardized professional skill phrase ' +
    '(e.g. "stakeholder management", "React", "financial modeling"). Return [] if nothing relevant.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: 'Support needed:\n' + (supportNeeded || '(none)') +
                   '\n\nManaged well:\n' + (managedWell || '(none)'),
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';
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

async function canonicalizeViaEsco(phrase: string, contextText: string) {
  const r = await escoExtract(phrase);
  for (const candidate of r ?? []) {
    if (isAcceptableCanonicalization(phrase, candidate.label) &&
        escoRelevantToInput(candidate.label, contextText + ' ' + phrase)) {
      return candidate;
    }
  }
  return { label: phrase, uri: '' };
}

async function classifyOneText(text: string) {
  if (!isSubstantive(text)) return { pairs: [] as { label: string; uri: string }[], usedEsco: false, usedHeuristic: false };
  const heuristicHits = heuristicMatch(text);

  if (heuristicHits.length > 0) {
    const enriched = await Promise.all(
      heuristicHits.map(async (phrase) => {
        const r = await escoExtract(phrase);
        for (const candidate of r ?? []) {
          if (isAcceptableCanonicalization(phrase, candidate.label)) return candidate;
        }
        return { label: phrase, uri: '' };
      }),
    );
    return { pairs: enriched.slice(0, 5), usedEsco: enriched.some((p) => p.uri), usedHeuristic: true };
  }

  const escoHits = await escoExtract(text);
  if (Array.isArray(escoHits) && escoHits.length > 0) {
    const relevant = escoHits.filter((h) => escoRelevantToInput(h.label, text));
    if (relevant.length > 0) return { pairs: relevant.slice(0, 5), usedEsco: true, usedHeuristic: false };
  }
  return { pairs: [], usedEsco: false, usedHeuristic: false };
}

function dedupe(pairs: { label: string; uri: string }[]) {
  const seen = new Set<string>();
  const out: { label: string; uri: string }[] = [];
  for (const p of pairs) {
    const key = (p.label || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({}));
  const reflectionId = Number(body.reflection_log_id);
  if (!Number.isFinite(reflectionId)) return jsonError('reflection_log_id_required');

  const { data: log, error } = await ctx.sb
    .from('reflection_logs')
    .select('*')
    .eq('id', reflectionId)
    .eq('user_id', ctx.user.id)
    .single();
  if (error || !log) return jsonError('not_found', 404);

  const supportNeeded = log.support_needed ?? '';
  const managedWell = log.managed_well ?? '';

  // Path A: Claude + ESCO
  const claude = await claudeExtractCandidates(supportNeeded, managedWell);
  let gapPairs: { label: string; uri: string }[];
  let strengthPairs: { label: string; uri: string }[];
  let source: string;

  if (claude) {
    gapPairs = await Promise.all(claude.gaps.map((p) => canonicalizeViaEsco(p, supportNeeded)));
    strengthPairs = await Promise.all(claude.strengths.map((p) => canonicalizeViaEsco(p, managedWell)));
    source = 'claude-haiku-4-5+esco';
  } else {
    // Path B: heuristic / ESCO direct per text
    const [g, s] = await Promise.all([classifyOneText(supportNeeded), classifyOneText(managedWell)]);
    gapPairs = g.pairs;
    strengthPairs = s.pairs;
    const usedEsco = g.usedEsco || s.usedEsco;
    const usedHeuristic = g.usedHeuristic || s.usedHeuristic;
    source = usedEsco && usedHeuristic ? 'esco+heuristic'
           : usedEsco ? 'esco'
           : usedHeuristic ? 'heuristic' : 'esco';
  }

  const gaps = dedupe(gapPairs);
  const strengths = dedupe(strengthPairs);
  const uris: Record<string, string> = {};
  for (const p of [...gaps, ...strengths]) if (p.uri) uris[p.label] = p.uri;

  await ctx.sb
    .from('reflection_logs')
    .update({
      extracted_gaps: gaps.map((p) => p.label),
      extracted_strengths: strengths.map((p) => p.label),
      esco_uris: uris,
      classifier_source: source,
    })
    .eq('id', reflectionId);

  return jsonOk({
    id: reflectionId,
    extracted_gaps: gaps.map((p) => p.label),
    extracted_strengths: strengths.map((p) => p.label),
    esco_uris: uris,
    classifier_source: source,
  });
});
