import { corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';
import { aiErrorResponse, mistralJson } from '../_shared/mistral.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({}));
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

  let result;
  try {
    const classified = await mistralJson<{ extracted_gaps?: string[]; extracted_strengths?: string[] }>({
      system: 'Classify a private professional reflection into concise skill names. Return JSON with extracted_gaps and extracted_strengths arrays. Use at most five items per array. Use only evidence in the reflection, do not diagnose or infer sensitive traits.',
      user: JSON.stringify({ support_needed: log.support_needed || '', managed_well: log.managed_well || '' }),
      temperature: 0,
      maxTokens: 350,
    });
    const normalize = (items: unknown) => Array.isArray(items)
      ? [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 5)
      : [];
    result = {
      extracted_gaps: normalize(classified.value.extracted_gaps),
      extracted_strengths: normalize(classified.value.extracted_strengths),
      esco_uris: {},
      classifier_source: `mistral:${classified.model}`,
    };
  } catch (classificationError) {
    const mapped = aiErrorResponse(classificationError);
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
