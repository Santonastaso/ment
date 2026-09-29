import { corsHeaders, jsonError } from '../_shared/index.ts';

// Organization and administrator provisioning is invitation-only until email
// verification and approval are part of the public signup flow.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
  return jsonError('signup_requires_invitation', 403);
});
