// Persist deterministic demo suggestions; applying them remains a user action.
import { corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';
import { demoReflection } from '../_shared/demo.ts';

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

  const result = demoReflection(log.support_needed ?? '', log.managed_well ?? '');
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
