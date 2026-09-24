import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

async function digest(value: string) {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('rate_limit_unavailable');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function requestAddress(req: Request) {
  return req.headers.get('cf-connecting-ip') || 'unknown';
}

export async function enforceRateLimit(
  sb: SupabaseClient,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
) {
  const keyHash = await digest(`${scope}:${subject}`);
  const { data, error } = await sb.rpc('consume_edge_rate_limit', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error('rate_limit_unavailable');
  return data === true;
}
