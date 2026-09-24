import { corsHeaders, jsonError, jsonOk, requireAdmin } from '../_shared/index.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireAdmin(req); } catch (response) { return response as Response; }
  try {
    if (!await enforceRateLimit(ctx.sb, 'create-invitation', ctx.user.id, 50, 86400)) {
      return jsonError('rate_limited', 429);
    }
  } catch {
    return jsonError('rate_limit_unavailable', 503);
  }
  const organizationId = ctx.profile?.organization_id;
  if (!organizationId) return jsonError('organization_required', 403);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const expiresInDays = Math.min(30, Math.max(1, Number(body.expires_in_days) || 7));
  if (!emailPattern.test(email)) return jsonError('valid_email_required');

  const profileData = {
    name: String(body.name || '').trim(),
    program: String(body.program || '').trim(),
    cohort_year: Number(body.cohort_year) || null,
    role: ['student', 'alumnus'].includes(body.role) ? body.role : 'student',
    department: String(body.department || '').trim(),
    job_title: String(body.job_title || '').trim(),
    location: String(body.location || '').trim(),
    linkedin_url: String(body.linkedin_url || '').trim(),
    linkedin_headline: String(body.linkedin_headline || '').trim(),
    external_source: String(body.external_source || '').trim() || null,
    external_id: String(body.external_id || '').trim() || null,
  };

  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(randomBytes);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();

  await ctx.sb.from('invitations').update({ status: 'revoked' })
    .eq('organization_id', organizationId)
    .eq('email', email)
    .eq('status', 'pending');

  const { data, error } = await ctx.sb.from('invitations').insert({
    organization_id: organizationId,
    email,
    token_hash: tokenHash,
    profile_data: profileData,
    invited_by: ctx.user.id,
    expires_at: expiresAt,
  }).select('id,email,expires_at,created_at').single();
  if (error) return jsonError(`invitation_create_failed: ${error.message}`, 500);

  const appOrigin = String(body.app_origin || Deno.env.get('APP_ORIGIN') || '').replace(/\/$/, '');
  return jsonOk({ ...data, invitation_url: `${appOrigin}/invite/${token}` }, 201);
});
