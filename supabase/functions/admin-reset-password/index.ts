// Admin: reset a user's password to a fresh temp password.
// Body: { user_id: string }
// Returns: { email, tempPassword }

import { corsHeaders, generateTempPassword, jsonError, jsonOk, requireAdmin } from '../_shared/index.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireAdmin(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({}));
  const userId = (body.user_id || '').toString();
  if (!userId) return jsonError('user_id_required');
  if (userId === ctx.user.id) return jsonError('cannot_reset_self');

  const { data: target } = await ctx.sb
    .from('profiles')
    .select('id, is_admin')
    .eq('id', userId)
    .single();
  if (!target || target.is_admin) return jsonError('user_not_found', 404);

  const { data: authUser } = await ctx.sb.auth.admin.getUserById(userId);
  if (!authUser?.user?.email) return jsonError('user_not_found', 404);

  const tempPassword = generateTempPassword();
  const { error: updErr } = await ctx.sb.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (updErr) return jsonError(updErr.message, 500);

  await ctx.sb.from('profiles').update({ must_change_password: true }).eq('id', userId);

  return jsonOk({
    email: authUser.user.email,
    tempPassword,
    message: 'Share this once. The user must change it on next login.',
  });
});
