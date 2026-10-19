// Daily data retention. Called by the data-retention workflow with the service
// role. The database applies each organisation's periods (run_data_retention);
// this function then closes the logins of accounts it erased. With no periods
// set, nothing is deleted.

import { adminClient, closeErasedLogin, corsHeaders, generateTempPassword, jsonError, jsonOk } from '../_shared/index.ts';

function hasServiceRole(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
  if (!hasServiceRole(req)) return jsonError('service_role_required', 403);

  const sb = adminClient();
  const { data, error } = await sb.rpc('run_data_retention');
  if (error) {
    console.error(JSON.stringify({ event: 'retention_failed', code: error.code || '' }));
    return jsonError('retention_failed', 500);
  }
  const erased: string[] = Array.isArray(data?.erased_user_ids) ? data.erased_user_ids : [];
  let loginsClosed = 0;
  for (const userId of erased) {
    if (!await closeErasedLogin(sb, userId, generateTempPassword() + generateTempPassword())) loginsClosed += 1;
  }
  // Counts only: which accounts were erased is not logged.
  const summary = { ...data, erased_user_ids: undefined, accounts_erased: erased.length, logins_closed: loginsClosed };
  console.log(JSON.stringify({ event: 'retention_done', ...summary }));
  return jsonOk(summary, loginsClosed === erased.length ? 200 : 500);
});
