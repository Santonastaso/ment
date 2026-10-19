import { aiOptedOut, corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';
import { normalizeLang } from '../_shared/esco.ts';
import { recordAiRun } from '../_shared/ai-telemetry.ts';
import { aiErrorResponse, mistralJson } from '../_shared/mistral.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', it: 'Italian', fr: 'French' };
const PROMPT_VERSION = 'reflection-v2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (r) { return r as Response; }
  try {
    if (!await enforceRateLimit(ctx.sb, 'reflection-classify', ctx.user.id, 20, 3600)) {
      return jsonError('rate_limited', 429);
    }
  } catch {
    return jsonError('rate_limit_unavailable', 503);
  }

  const body = await req.json().catch(() => ({}));
  const lang = normalizeLang(body.lang);
  const language = LANGUAGE_NAMES[lang] || 'English';
  const reflectionId = Number(body.reflection_log_id);
  if (!Number.isSafeInteger(reflectionId) || reflectionId <= 0) {
    return jsonError('reflection_log_id_required');
  }

  const { data: log, error } = await ctx.sb
    .from('reflection_logs')
    .select('*')
    .eq('id', reflectionId)
    .eq('user_id', ctx.user.id)
    .single();
  if (error) {
    return error.code === 'PGRST116'
      ? jsonError('not_found', 404)
      : jsonError(`read_failed: ${error.message}`, 500);
  }
  if (!log) return jsonError('not_found', 404);

  // Opted out of AI: the reflection is kept as written, with no tags.
  if (await aiOptedOut(ctx.sb, ctx.user.id)) {
    return jsonOk({ id: reflectionId, extracted_gaps: [], extracted_strengths: [], skipped: 'ai_opted_out' });
  }

  let result;
  const startedAt = Date.now();
  try {
    const classified = await mistralJson<{ extracted_gaps?: string[]; extracted_strengths?: string[] }>({
      feature: 'reflection',
      system: `Classify a private professional reflection into concise skill names written in ${language}. Return JSON with extracted_gaps and extracted_strengths arrays. Name only the skill each answer is actually about: usually one per array, never more than two, and an empty array when the answer names none. Do not add related, broader or implied skills: \"leadership\" is one skill, not leadership plus strategic planning and conflict resolution. Use only evidence in the reflection, do not diagnose or infer sensitive traits.

Use short, conventional skill names as they would appear in a professional skills list: two or three words separated by spaces, never underscores, lower case, noun form ("financial modelling", not "modelling financial statements"). Prefer a widely used name over a precise description.`,
      user: JSON.stringify({ support_needed: log.support_needed || '', managed_well: log.managed_well || '' }),
      temperature: 0,
      maxTokens: 350,
    });
    const normalize = (items: unknown) => Array.isArray(items)
      ? [...new Set(items.map((item) => String(item || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 2)
      : [];
    result = {
      extracted_gaps: normalize(classified.value.extracted_gaps),
      extracted_strengths: normalize(classified.value.extracted_strengths),
      esco_uris: {},
      classifier_source: `mistral:${classified.model}:esco-unresolved`,
    };
    const { data: owner } = await ctx.sb.from('profiles').select('organization_id').eq('id', ctx.user.id).maybeSingle();
    await recordAiRun(ctx.sb, {
      userId: ctx.user.id,
      organizationId: owner?.organization_id,
      feature: 'reflection',
      promptVersion: PROMPT_VERSION,
      model: classified.model,
      latencyMs: classified.latencyMs,
    });
  } catch (classificationError) {
    const mapped = aiErrorResponse(classificationError);
    const { data: owner } = await ctx.sb.from('profiles').select('organization_id').eq('id', ctx.user.id).maybeSingle();
    await recordAiRun(ctx.sb, {
      userId: ctx.user.id, organizationId: owner?.organization_id, feature: 'reflection',
      promptVersion: PROMPT_VERSION, model: 'unknown', latencyMs: Date.now() - startedAt,
      status: 'failed', errorCode: mapped.message,
    });
    return jsonError(mapped.message, mapped.status);
  }
  const { data: saved, error: updateError } = await ctx.sb
    .from('reflection_logs')
    .update(result)
    .eq('id', reflectionId)
    .eq('user_id', ctx.user.id)
    .select('id')
    .single();
  if (updateError) return jsonError(`update_failed: ${updateError.message}`, 500);
  if (!saved) return jsonError('not_found', 404);

  return jsonOk({ id: reflectionId, ...result });
});
