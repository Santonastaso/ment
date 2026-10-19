// Shared helpers for Edge Functions: caller identification + admin gate.
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'auth_required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const token = auth.slice('Bearer '.length);
  const sb = adminClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('deactivated_at').eq('id', data.user.id).maybeSingle();
  if (profileError || !profile || profile.deactivated_at) {
    throw new Response(JSON.stringify({ error: 'account_deactivated' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return { user: data.user, sb };
}

// A member who opted out of AI (profiles.ai_opt_out) never has their data sent
// to the model. Read failures count as opted out: refusing is the safe side.
export async function aiOptedOut(sb: SupabaseClient, userId: string) {
  const { data, error } = await sb.from('profiles').select('ai_opt_out').eq('id', userId).maybeSingle();
  return Boolean(error || !data || data.ai_opt_out);
}

export async function requireAdmin(req: Request) {
  const ctx = await requireUser(req);
  const { data: profile } = await ctx.sb
    .from('profiles')
    .select('id, is_admin, admin_scope, organization_id')
    .eq('id', ctx.user.id)
    .single();
  if (!profile || (!profile.is_admin && !['org', 'platform'].includes(profile.admin_scope || ''))) {
    throw new Response(JSON.stringify({ error: 'admin_only' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return { ...ctx, profile };
}

export function jsonOk(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Close an erased member's login for good: the address is replaced, the
// password is unknowable and the account is banned. Only the auth API can do
// this, so it follows erase_account_data rather than living in the database.
export async function closeErasedLogin(sb: SupabaseClient, userId: string, password: string) {
  const { error } = await sb.auth.admin.updateUserById(userId, {
    email: `erased-${userId}@erased.invalid`,
    email_confirm: true,
    password,
    user_metadata: {},
    ban_duration: '876000h', // about a hundred years
  });
  return error;
}
