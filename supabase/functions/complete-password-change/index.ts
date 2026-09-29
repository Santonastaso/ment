import { corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
  let ctx;
  try { ctx = await requireUser(req); } catch (response) { return response as Response; }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) return jsonError('invalid_password');

  const { data: profile, error: profileError } = await ctx.sb.from('profiles')
    .select('must_change_password').eq('id', ctx.user.id).maybeSingle();
  if (profileError || !profile) return jsonError('profile_not_found', 404);
  if (!profile.must_change_password) return jsonError('password_change_not_required', 409);

  const { error: passwordError } = await ctx.sb.auth.admin.updateUserById(ctx.user.id, { password });
  if (passwordError) return jsonError('password_update_failed', 400);
  const { error: flagError } = await ctx.sb.from('profiles')
    .update({ must_change_password: false }).eq('id', ctx.user.id);
  if (flagError) return jsonError('password_saved_but_account_update_failed', 500);
  return jsonOk({ ok: true });
});
