// Erase an account (GDPR Art. 17).
// Body, member: { confirm: 'DELETE' } erases the caller.
// Body, admin:  { user_id } erases a member of the admin's organisation.
// The database removes the data (erase_account_data); this function then
// scrubs the login so the address is gone and nobody can sign in again.

import {
  corsHeaders, generateTempPassword, jsonError, jsonOk, requireAdmin, requireUser,
} from '../_shared/index.ts';

const NEVER = '876000h'; // about a hundred years

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  const body = await req.clone().json().catch(() => ({}));
  const requested = (body.user_id || '').toString();
  let ctx;
  let userId: string;
  if (requested) {
    try { ctx = await requireAdmin(req); } catch (r) { return r as Response; }
    if (requested === ctx.user.id) return jsonError('cannot_erase_self_as_admin');
    const { data: target } = await ctx.sb.from('profiles')
      .select('id, is_admin, admin_scope, organization_id').eq('id', requested).maybeSingle();
    // Admins are not erased from here, and an org admin reaches only their own organisation.
    if (!target || target.is_admin || target.admin_scope !== 'none') return jsonError('user_not_found', 404);
    if (ctx.profile.admin_scope !== 'platform' && target.organization_id !== ctx.profile.organization_id) {
      return jsonError('user_not_found', 404);
    }
    userId = requested;
  } else {
    try { ctx = await requireUser(req); } catch (r) { return r as Response; }
    if (body.confirm !== 'DELETE') return jsonError('confirmation_required');
    userId = ctx.user.id;
  }

  const { error } = await ctx.sb.rpc('erase_account_data', { p_user_id: userId });
  if (error) {
    if (/admin_account/.test(error.message)) return jsonError('admin_account', 403);
    console.error(JSON.stringify({ event: 'account_erase_failed', stage: 'data', code: error.code || '' }));
    return jsonError('erase_failed', 500);
  }

  const { error: loginError } = await ctx.sb.auth.admin.updateUserById(userId, {
    email: `erased-${userId}@erased.invalid`,
    email_confirm: true,
    password: generateTempPassword() + generateTempPassword(),
    user_metadata: {},
    ban_duration: NEVER,
  });
  if (loginError) {
    // The data is already gone and the profile deactivated; an admin can run
    // the erase again to finish the login, since the database step repeats safely.
    console.error(JSON.stringify({ event: 'account_erase_failed', stage: 'login', status: loginError.status || 0 }));
    return jsonError('login_erase_failed', 500);
  }

  console.log(JSON.stringify({ event: 'account_erased', by: requested ? 'admin' : 'self' }));
  return jsonOk({ erased: true });
});
