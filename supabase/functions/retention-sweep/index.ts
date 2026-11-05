// Daily data retention. Called by the data-retention workflow with the service
// role. The database applies each organisation's periods (run_data_retention);
// this function then closes the logins of accounts it erased. Transient CV
// uploads older than seven days are also removed, even with no periods set.

import { adminClient, closeErasedLogin, corsHeaders, generateTempPassword, jsonError, jsonOk } from '../_shared/index.ts';
import { removeStaleProfileUploads, removeUserProfileUploads } from '../_shared/profile-uploads.mjs';

const STALE_UPLOAD_DAYS = 7;

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
  const { data: candidates, error: candidateError } = await sb.rpc('retention_account_candidates');
  if (candidateError) {
    console.error(JSON.stringify({ event: 'retention_failed', stage: 'account_candidates', code: candidateError.code || '' }));
    return jsonError('retention_failed', 500);
  }
  const candidateIds: string[] = Array.isArray(candidates) ? candidates : [];
  const { data: pendingAuthData, error: pendingAuthError } = await sb.rpc('retention_auth_cleanup_candidates');
  if (pendingAuthError) {
    console.error(JSON.stringify({ event: 'retention_failed', stage: 'auth_cleanup_candidates', code: pendingAuthError.code || '' }));
    return jsonError('retention_failed', 500);
  }
  const pendingAuthIds: string[] = Array.isArray(pendingAuthData) ? pendingAuthData : [];
  let accountUploadsReady = true;
  try {
    for (const userId of new Set([...candidateIds, ...pendingAuthIds])) {
      await removeUserProfileUploads(sb.storage, userId);
    }
  } catch (error) {
    // Account erasure must wait, but unrelated database retention can proceed.
    accountUploadsReady = false;
    console.error(JSON.stringify({ event: 'retention_failed', stage: 'account_uploads', code: error instanceof Error ? error.message : 'unknown' }));
  }

  let staleUploads = { removed: 0, undated: 0 };
  let staleUploadFailed = false;
  try {
    // CV uploads are transient, including for members whose accounts remain active.
    // A grace period avoids interfering with an upload that has yet to be ingested.
    staleUploads = await removeStaleProfileUploads(
      sb.storage, new Date(Date.now() - STALE_UPLOAD_DAYS * 24 * 60 * 60 * 1000),
    );
  } catch (error) {
    // Still apply database retention. Return a failed job after that work so
    // the missed upload cleanup remains visible and can be retried tomorrow.
    staleUploadFailed = true;
    console.error(JSON.stringify({ event: 'retention_failed', stage: 'stale_profile_uploads', code: error instanceof Error ? error.message : 'unknown' }));
  }

  const { data, error } = await sb.rpc('run_data_retention');
  if (error) {
    console.error(JSON.stringify({ event: 'retention_failed', code: error.code || '' }));
    return jsonError('retention_failed', 500);
  }
  let erased: string[] = [];
  let authCleanupIds = pendingAuthIds;
  let loginsClosed = 0;
  if (accountUploadsReady) {
    const { data: erasedData, error: eraseError } = await sb.rpc('run_retention_account_erasure', { p_candidates: candidateIds });
    if (eraseError) {
      console.error(JSON.stringify({ event: 'retention_failed', stage: 'account_erasure', code: eraseError.code || '' }));
      return jsonError('retention_failed', 500);
    }
    erased = Array.isArray(erasedData) ? erasedData : [];
    const { data: authCleanupData, error: authCleanupError } = await sb.rpc('retention_auth_cleanup_candidates');
    if (authCleanupError) {
      console.error(JSON.stringify({ event: 'retention_failed', stage: 'auth_cleanup_candidates', code: authCleanupError.code || '' }));
      return jsonError('retention_failed', 500);
    }
    authCleanupIds = Array.isArray(authCleanupData) ? authCleanupData : [];
    for (const userId of authCleanupIds) {
      if (await closeErasedLogin(sb, userId, generateTempPassword() + generateTempPassword())) continue;
      const { error: completeError } = await sb.rpc('complete_account_auth_cleanup', { p_user_id: userId });
      if (!completeError) loginsClosed += 1;
    }
  }
  // Counts only: which accounts were erased is not logged.
  const summary = { ...data, erased_user_ids: undefined, accounts_erased: erased.length,
    logins_closed: loginsClosed, auth_cleanup_pending: authCleanupIds.length - loginsClosed,
    stale_uploads_removed: staleUploads.removed, stale_uploads_undated: staleUploads.undated,
    stale_upload_cleanup_failed: staleUploadFailed, account_upload_cleanup_failed: !accountUploadsReady,
    account_erasure_deferred: accountUploadsReady ? 0 : candidateIds.length };
  console.log(JSON.stringify({ event: 'retention_done', ...summary }));
  return jsonOk(summary, accountUploadsReady && !staleUploadFailed && loginsClosed === authCleanupIds.length ? 200 : 500);
});
