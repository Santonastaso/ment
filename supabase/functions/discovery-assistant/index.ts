import { corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';
import { aiErrorResponse, mistralJson } from '../_shared/mistral.ts';

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

function publicCandidate(candidate: Candidate) {
  const expertise = [...new Set([...(candidate.skills || []), candidate.job_title, candidate.department].filter(Boolean))].slice(0, 3);
  return {
    id: candidate.id,
    name: candidate.name,
    job_title: candidate.job_title,
    department: candidate.department,
    program: candidate.program,
    cohort_year: candidate.cohort_year,
    linkedin_headline: candidate.linkedin_headline,
    expertise,
    background: [candidate.program, candidate.department].filter(Boolean).join(' · ') || candidate.job_title || 'Professional experience',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (response) { return response as Response; }
  const body = await req.json().catch(() => ({}));
  const action = body.action === 'draft' ? 'draft' : 'match';
  const query = cleanText(body.query);
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
        system: 'You draft concise, warm introductions between verified university-network members. Use only supplied facts. Never invent employers, credentials, locations, skills, or relationships. Return JSON with one string field named draft. Keep it under 120 words.',
        user: JSON.stringify({ requester_first_name: String(caller.name || '').split(' ')[0], request: query, recipient: publicCandidate(selected), variant: Number(body.variant) || 0 }),
        temperature: Number(body.variant) ? 0.35 : 0.15,
        maxTokens: 350,
      });
      const draft = cleanText(result.value?.draft, 2000);
      if (!draft) return jsonError('ai_invalid_response', 502);
      return jsonOk({ draft, model: result.model });
    } catch (error) {
      const mapped = aiErrorResponse(error);
      return jsonError(mapped.message, mapped.status);
    }
  }

  if (!candidates.length) return jsonOk({ matches: [] });
  try {
    const result = await mistralJson<{ profile_ids?: string[] }>({
      system: 'Rank verified university-network profiles for the user request. Use only supplied candidates. Return JSON with profile_ids containing up to three candidate IDs in best-first order. Never output an ID not present in candidates. Prefer direct skill and professional-background evidence; do not use location as professional background.',
      user: JSON.stringify({ request: query, candidates: candidates.map(publicCandidate) }),
      temperature: 0,
      maxTokens: 250,
    });
    const validIds = [...new Set(Array.isArray(result.value?.profile_ids) ? result.value.profile_ids : [])]
      .filter((id) => candidates.some((candidate) => candidate.id === id))
      .slice(0, 3);
    if (!validIds.length) return jsonError('ai_no_valid_matches', 422);
    return jsonOk({ matches: validIds.map((id) => publicCandidate(candidates.find((candidate) => candidate.id === id)!)), model: result.model });
  } catch (error) {
    const mapped = aiErrorResponse(error);
    return jsonError(mapped.message, mapped.status);
  }
});
