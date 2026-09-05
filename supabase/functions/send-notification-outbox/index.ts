import { createClient } from 'jsr:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendKey = Deno.env.get('RESEND_API_KEY');
const from = Deno.env.get('NOTIFICATION_FROM_EMAIL') || 'MENT <notifications@example.com>';
const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function hasServiceRole(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!hasServiceRole(req)) return json({ error: 'service_role_required' }, 403);
  if (!resendKey) return json({ error: 'RESEND_API_KEY_not_configured' }, 503);

  // Recover jobs left mid-send if the worker was interrupted.
  await sb
    .from('notification_outbox')
    .update({ status: 'queued', claimed_at: null })
    .eq('status', 'sending')
    .lt('claimed_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const { data: rows, error } = await sb
    .from('notification_outbox')
    .select('id, user_id, topic, payload')
    .eq('status', 'queued')
    .order('created_at')
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;
  for (const row of rows || []) {
    const { data: claim } = await sb
      .from('notification_outbox')
      .update({ status: 'sending', claimed_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (!claim) continue;

    const { data: authUser } = await sb.auth.admin.getUserById(row.user_id);
    const email = authUser?.user?.email;
    if (!email) {
      failed++;
      await sb.from('notification_outbox').update({ status: 'failed', claimed_at: null }).eq('id', row.id).eq('status', 'sending');
      continue;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your MENT reflection is ready',
        text: 'Take two minutes to reflect on what you need support with and what went well this week.',
      }),
    });
    if (response.ok) {
      sent++;
      await sb.from('notification_outbox').update({ status: 'sent', claimed_at: null, sent_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'sending');
    } else {
      failed++;
      await sb.from('notification_outbox').update({ status: 'failed', claimed_at: null }).eq('id', row.id).eq('status', 'sending');
    }
  }
  return json({ sent, failed });
});
