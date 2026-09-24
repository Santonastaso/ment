import { adminClient, corsHeaders, jsonError, jsonOk } from '../_shared/index.ts';
import { enforceRateLimit, requestAddress } from '../_shared/rate-limit.ts';

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (token.length < 32) return jsonError('invalid_invitation', 400);
  if (password.length < 12) return jsonError('password_too_short', 400);

  const sb = adminClient();
  try {
    if (!await enforceRateLimit(sb, 'accept-invitation', requestAddress(req), 20, 3600)) {
      return jsonError('rate_limited', 429);
    }
  } catch {
    return jsonError('rate_limit_unavailable', 503);
  }
  const tokenHash = await sha256(token);
  const { data: invitation, error: invitationError } = await sb.from('invitations')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('status', 'pending')
    .maybeSingle();
  if (invitationError) return jsonError('invitation_lookup_failed', 500);
  if (!invitation || new Date(invitation.expires_at).getTime() <= Date.now()) {
    if (invitation) await sb.from('invitations').update({ status: 'expired' }).eq('id', invitation.id);
    return jsonError('invitation_invalid_or_expired', 410);
  }

  const profile = invitation.profile_data || {};
  const { data: created, error: createError } = await sb.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: {
      name: profile.name || invitation.email.split('@')[0],
      organization_id: invitation.organization_id,
      onboarding_complete: false,
      must_change_password: false,
    },
  });
  if (createError || !created.user) {
    const message = createError?.message?.toLowerCase().includes('already') ? 'account_already_exists' : 'account_create_failed';
    return jsonError(message, message === 'account_already_exists' ? 409 : 500);
  }

  const userId = created.user.id;
  const { error: profileError } = await sb.from('profiles').update({
    name: profile.name || invitation.email.split('@')[0],
    organization_id: invitation.organization_id,
    program: profile.program || '',
    cohort_year: profile.cohort_year || null,
    role: profile.role || 'student',
    department: profile.department || '',
    job_title: profile.job_title || '',
    location: profile.location || '',
    linkedin_url: profile.linkedin_url || '',
    linkedin_headline: profile.linkedin_headline || '',
    external_source: profile.external_source || null,
    external_id: profile.external_id || null,
    source_synced_at: profile.external_source ? new Date().toISOString() : null,
    onboarding_complete: false,
    must_change_password: false,
  }).eq('id', userId);
  if (profileError) {
    await sb.auth.admin.deleteUser(userId);
    return jsonError('profile_create_failed', 500);
  }

  const { data: accepted, error: acceptError } = await sb.from('invitations').update({
    status: 'accepted', accepted_at: new Date().toISOString(), accepted_user_id: userId,
  }).eq('id', invitation.id).eq('status', 'pending').select('id').maybeSingle();
  if (acceptError || !accepted) {
    await sb.auth.admin.deleteUser(userId);
    return jsonError('invitation_already_used', 409);
  }

  return jsonOk({ email: invitation.email, user_id: userId }, 201);
});
