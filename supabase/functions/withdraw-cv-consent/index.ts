import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, jsonError, jsonOk, requireUser, SUPABASE_URL, SERVICE_ROLE_KEY } from '../_shared/auth.ts';
import { createWithdrawCvConsentHandler } from '../_shared/withdraw-cv-consent.mjs';

Deno.serve(createWithdrawCvConsentHandler({
  requireUser, corsHeaders, jsonOk, jsonError,
  callerClient: (req: Request) => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
    auth: { persistSession: false, autoRefreshToken: false },
  }),
}));
