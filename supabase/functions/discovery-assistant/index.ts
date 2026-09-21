import { corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';
import { recordAiRun } from '../_shared/ai-telemetry.ts';
import { aiErrorResponse, mistralJson } from '../_shared/mistral.ts';

const PROMPT_VERSION = 'discovery-v2';

type Candidate = {
  id: string;
  name: string;
  job_title?: string | null;
  department?: string | null;
  program?: string | null;
  cohort_year?: number | null;
  bio?: string | null;
  linkedin_headline?: string | null;
  skills: string[];
};

const cleanText = (value: unknown, max = 2000) => String(value || '').trim().slice(0, max);

type RankedMatch = {
  profile_id?: string;
  reasons?: string[];
  matched_expertise?: string[];
};

const LANGUAGES: Record<string, string> = { en: 'English', it: 'Italian', fr: 'French' };
const localeName = (value: unknown) => LANGUAGES[String(value || '').toLowerCase()] || 'English';

function publicCandidate(candidate: Candidate, ranked?: RankedMatch) {
  const expertise = [...new Set([...(candidate.skills || []), candidate.job_title, candidate.department].filter(Boolean))].slice(0, 3);
  const allowedExpertise = new Map(expertise.map((item) => [String(item).toLowerCase(), String(item)]));
  const matchedExpertise = Array.isArray(ranked?.matched_expertise)
    ? ranked.matched_expertise.map((item) => allowedExpertise.get(cleanText(item, 100).toLowerCase())).filter(Boolean).slice(0, 3)
    : [];
  return {
    id: candidate.id,
    name: candidate.name,
    job_title: candidate.job_title,
    department: candidate.department,
    program: candidate.program,
    cohort_year: candidate.cohort_year,
    linkedin_headline: candidate.linkedin_headline,
    expertise: matchedExpertise.length ? matchedExpertise : expertise,
    background: [candidate.program, candidate.department].filter(Boolean).join(' · ') || candidate.job_title || 'Professional experience',
    reasons: Array.isArray(ranked?.reasons)
      ? ranked.reasons.map((reason) => cleanText(reason, 180)).filter(Boolean).slice(0, 2)
      : [],
  };
}

async function persistTurns(
  ctx: Awaited<ReturnType<typeof requireUser>>,
  threadId: unknown,
  query: string,
  assistant: Record<string, unknown>,
  selectedPersonId?: string,
) {
  const now = new Date().toISOString();
  let existing = null;
  if (typeof threadId === 'string' && threadId) {
    const { data } = await ctx.sb.from('discovery_threads')
      .select('id,turns')
      .eq('id', threadId)
      .eq('user_id', ctx.user.id)
      .maybeSingle();
    existing = data;
  }
  const nextTurns = assistant.kind === 'draft'
    ? [{ role: 'assistant', ...assistant, at: now }]
    : [{ role: 'user', content: query, at: now }, { role: 'assistant', ...assistant, at: now }];
  const turns = [
    ...(Array.isArray(existing?.turns) ? existing.turns : []),
    ...nextTurns,
  ].slice(-40);
  if (existing?.id) {
    const { data } = await ctx.sb.from('discovery_threads').update({
      turns,
      selected_person_id: selectedPersonId || null,
      updated_at: now,
    }).eq('id', existing.id).eq('user_id', ctx.user.id).select('id').single();
    return data?.id || existing.id;
  }
  const { data } = await ctx.sb.from('discovery_threads').insert({
    user_id: ctx.user.id,
    title: query.slice(0, 80),
    turns,
    selected_person_id: selectedPersonId || null,
  }).select('id').single();
  return data?.id || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (response) { return response as Response; }
  const body = await req.json().catch(() => ({}));
  const action = body.action === 'draft' ? 'draft' : 'match';
  const query = cleanText(body.query);
  const language = localeName(body.lang);
  if (query.length < 3) return jsonError('query_too_short');

  const { data: caller, error: callerError } = await ctx.sb.from('profiles')
    .select('id,name,organization_id')
    .eq('id', ctx.user.id)
    .single();
  if (callerError || !caller?.organization_id) return jsonError('profile_not_found', 404);

  const { data: rows, error: candidateError } = await ctx.sb.from('profiles')
    .select('id,name,job_title,department,program,cohort_year,bio,linkedin_headline,mentorship_paused,mentorship_unavailable_until,weekly_meeting_limit,monthly_meeting_limit')
    .eq('organization_id', caller.organization_id)
    .eq('admin_scope', 'none')
    .eq('onboarding_complete', true)
    .is('deactivated_at', null)
    .neq('id', ctx.user.id)
    .limit(100);
  if (candidateError) return jsonError('candidate_load_failed', 500);

  const profileIds = (rows || []).map((row) => row.id);
  const [{ data: skills }, { data: relationships }, { data: activeSessions }] = await Promise.all([
    profileIds.length ? ctx.sb.from('skills').select('user_id,skill').in('user_id', profileIds).eq('type', 'can_teach') : Promise.resolve({ data: [] }),
    ctx.sb.from('sessions').select('mentor_id,mentee_id,status').or(`mentor_id.eq.${ctx.user.id},mentee_id.eq.${ctx.user.id}`).in('status', ['pending', 'scheduled']),
    profileIds.length ? ctx.sb.from('sessions').select('mentor_id,status,created_at,accepted_at,request_expires_at').in('mentor_id', profileIds).in('status', ['pending', 'scheduled', 'completed']) : Promise.resolve({ data: [] }),
  ]);

  const related = new Set((relationships || []).map((session) => session.mentor_id === ctx.user.id ? session.mentee_id : session.mentor_id));
  const now = Date.now();
  const currentDate = new Date(now);
  const weekStart = new Date(currentDate);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const monthStart = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));
  const activeByMentor = new Map<string, { total: number; week: number }>();
  for (const session of activeSessions || []) {
    if (session.status === 'pending' && session.request_expires_at && new Date(session.request_expires_at).getTime() <= now) continue;
    const current = activeByMentor.get(session.mentor_id) || { total: 0, week: 0 };
    const capacityDate = new Date(session.status === 'pending' ? session.created_at : session.accepted_at);
    if (capacityDate.getTime() >= monthStart.getTime()) current.total += 1;
    if (capacityDate.getTime() >= weekStart.getTime()) current.week += 1;
    activeByMentor.set(session.mentor_id, current);
  }
  const skillsByUser = new Map<string, string[]>();
  for (const skill of skills || []) skillsByUser.set(skill.user_id, [...(skillsByUser.get(skill.user_id) || []), skill.skill]);

  const candidates: Candidate[] = (rows || []).filter((row) => {
    if (related.has(row.id) || row.mentorship_paused) return false;
    if (row.mentorship_unavailable_until && new Date(row.mentorship_unavailable_until).getTime() > now) return false;
    const usage = activeByMentor.get(row.id) || { total: 0, week: 0 };
    return usage.total < row.monthly_meeting_limit && usage.week < row.weekly_meeting_limit;
  }).map((row) => ({ ...row, skills: skillsByUser.get(row.id) || [] }));

  if (action === 'draft') {
    const selected = candidates.find((candidate) => candidate.id === body.person_id);
    if (!selected) return jsonError('candidate_unavailable', 409);
    try {
      const result = await mistralJson<{ draft?: string }>({
        feature: 'discovery_draft',
        system: `You draft concise, warm introductions between verified university-network members. Write in ${language}. Use only supplied facts. Never invent employers, credentials, locations, skills, or relationships. Return JSON with one string field named draft. Keep it under 120 words.`,
        user: JSON.stringify({ requester_first_name: String(caller.name || '').split(' ')[0], request: query, recipient: publicCandidate(selected), variant: Number(body.variant) || 0 }),
        temperature: Number(body.variant) ? 0.35 : 0.15,
        maxTokens: 350,
      });
      const draft = cleanText(result.value?.draft, 2000);
      if (!draft) return jsonError('ai_invalid_response', 502);
      await recordAiRun(ctx.sb, {
        userId: ctx.user.id,
        organizationId: caller.organization_id,
        feature: 'discovery_draft',
        promptVersion: PROMPT_VERSION,
        model: result.model,
        latencyMs: result.latencyMs,
      });
      const threadId = await persistTurns(ctx, body.thread_id, query, {
        kind: 'draft',
        content: draft,
        person: publicCandidate(selected),
      }, selected.id);
      return jsonOk({ draft, model: result.model, thread_id: threadId });
    } catch (error) {
      const mapped = aiErrorResponse(error);
      return jsonError(mapped.message, mapped.status);
    }
  }

  if (!candidates.length) return jsonOk({ matches: [] });
  try {
    const result = await mistralJson<{ matches?: RankedMatch[]; clarification?: string }>({
      feature: 'discovery_match',
      system: `Rank verified university-network profiles for the user request. Respond in ${language}. Use only supplied candidates and facts. If the request lacks enough professional context to rank responsibly, return {"clarification":"one short question","matches":[]}. Otherwise return {"clarification":"","matches":[{"profile_id":"candidate id","matched_expertise":["exact supplied skill"],"reasons":["one concrete reason tied directly to the request"]}]}. Return at most three matches in best-first order. Never output an ID not present in candidates. Never use location as expertise or professional background. Keep each reason under 24 words.`,
      user: JSON.stringify({ request: query, candidates: candidates.map(publicCandidate) }),
      temperature: 0,
      maxTokens: 700,
    });
    const clarification = cleanText(result.value?.clarification, 240);
    const ranked = Array.isArray(result.value?.matches) ? result.value.matches : [];
    const seen = new Set<string>();
    const matches = ranked.flatMap((item) => {
      const id = cleanText(item?.profile_id, 100);
      const candidate = candidates.find((entry) => entry.id === id);
      if (!candidate || seen.has(id)) return [];
      seen.add(id);
      return [publicCandidate(candidate, item)];
    }).slice(0, 3);
    await recordAiRun(ctx.sb, {
      userId: ctx.user.id,
      organizationId: caller.organization_id,
      feature: 'discovery_match',
      promptVersion: PROMPT_VERSION,
      model: result.model,
      latencyMs: result.latencyMs,
    });
    if (!matches.length && clarification) {
      const threadId = await persistTurns(ctx, body.thread_id, query, { kind: 'clarification', content: clarification });
      return jsonOk({ matches: [], clarification, thread_id: threadId, model: result.model });
    }
    if (!matches.length) return jsonError('ai_no_valid_matches', 422);
    const threadId = await persistTurns(ctx, body.thread_id, query, {
      kind: 'matches',
      content: 'matches_ready',
      matches,
    });
    return jsonOk({ matches, clarification: '', thread_id: threadId, model: result.model });
  } catch (error) {
    const mapped = aiErrorResponse(error);
    return jsonError(mapped.message, mapped.status);
  }
});
