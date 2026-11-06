import { removeUserProfileUploads } from './profile-uploads.mjs';

/** Each retry repeats withdrawal before continuing durable, idempotent deletion. */
export function createWithdrawCvConsentHandler({ requireUser, callerClient, corsHeaders, jsonOk, jsonError }) {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
    let ctx;
    try { ctx = await requireUser(req); } catch (response) { return response; }

    // This RPC must run with the verified caller's JWT: auth.uid() is not
    // populated on the service client. It atomically withdraws and deletes drafts.
    let withdrawn;
    try {
      const { data, error } = await callerClient(req).rpc('withdraw_cv_import_consent');
      if (error || !Number.isInteger(data) || data < 0) throw new Error('withdraw_failed');
      withdrawn = data;
    } catch {
      return jsonError('cv_withdrawal_unavailable', 503);
    }

    try {
      // Bound work per invocation. A retry starts at offset zero, including
      // after a timeout/ambiguous delete response. Never restore consent.
      const bucket = ctx.sb.storage.from('profile-uploads');
      let operations = 0;
      const limitedStorage = {
        from() {
          return {
            async list(...args) {
              if (++operations > 500) throw new Error('cleanup_budget_exhausted');
              const result = await bucket.list(...args);
              if (!Array.isArray(result.data)) throw new Error('cleanup_list_unavailable');
              return result;
            },
            async remove(...args) {
              if (++operations > 500) throw new Error('cleanup_budget_exhausted');
              return await bucket.remove(...args);
            },
          };
        },
      };
      const uploadsRemoved = await removeUserProfileUploads(limitedStorage, ctx.user.id);
      return jsonOk({ withdrawn, uploads_removed: uploadsRemoved, cleanup_complete: true });
    } catch {
      // Permission and drafts are already withdrawn, but files may remain.
      // The UI must report this as incomplete and allow the same request again.
      return jsonOk({ error: 'cv_upload_cleanup_pending', withdrawn, cleanup_complete: false }, 503);
    }
  };
}
