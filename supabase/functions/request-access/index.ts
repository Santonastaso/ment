import { adminClient, corsHeaders, jsonError, jsonOk } from '../_shared/index.ts';
import { enforceRateLimit, requestAddress } from '../_shared/rate-limit.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const field = (value: unknown, max: number) => {
  const valueText = String(value ?? '').trim();
  return valueText.length <= max ? valueText : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
  const body = await req.json().catch(() => ({}));
  if (String(body.website || body.url || body.honeypot || '').trim()) return jsonError('invalid_submission');

  const name = field(body.name, 120);
  const email = field(body.email || body.work_email, 254)?.toLowerCase();
  const company = field(body.company, 160);
  const companySize = field(body.company_size || body.companySize, 80);
  const role = field(body.role, 120);
  const note = field(body.note, 2000);
  if (name === null || email === null || company === null || companySize === null || role === null || note === null) {
    return jsonError('field_too_long');
  }
  if (!name || !company || !companySize || !role || !email || !EMAIL_RE.test(email)) {
    return jsonError('required_fields_missing');
  }

  const sb = adminClient();
  try {
    if (!await enforceRateLimit(sb, 'request-access', requestAddress(req), 5, 3600)) {
      return jsonError('rate_limited', 429);
    }
  } catch {
    return jsonError('rate_limit_unavailable', 503);
  }

  const { error } = await sb.from('access_requests').insert({
    name, email, company, company_size: companySize, role, note,
  });
  if (error?.code === '23505') return jsonError('request_already_open', 409);
  if (error) return jsonError('request_save_failed', 500);
  return jsonOk({ ok: true }, 201);
});
