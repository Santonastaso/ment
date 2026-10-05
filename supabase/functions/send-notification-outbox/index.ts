import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isDeliverable, messageFor } from '../_shared/notification-content.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendKey = Deno.env.get('RESEND_API_KEY');
const from = Deno.env.get('NOTIFICATION_FROM_EMAIL');
const appOrigin = Deno.env.get('APP_ORIGIN');
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
  if (!from || !appOrigin || !/^https:\/\/[^/]+$/i.test(appOrigin)) {
    return json({ error: 'notification_sender_not_configured' }, 503);
  }

  const { error: reminderError } = await sb.rpc('enqueue_meeting_reminders');
  if (reminderError) return json({ error: 'meeting_reminder_queue_failed' }, 500);

  // Recover jobs left mid-send if the worker was interrupted.
  await sb
    .from('notification_outbox')
    .update({ status: 'queued', claimed_at: null, next_attempt_at: new Date().toISOString() })
    .eq('status', 'sending')
    .lt('claimed_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const { data: rows, error } = await sb
    .from('notification_outbox')
    .select('id, user_id, topic, payload, created_at, idempotency_key, attempts')
    .eq('status', 'queued')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;
  for (const row of rows || []) {
    const { data: claim } = await sb
      .from('notification_outbox')
      .update({ status: 'sending', claimed_at: new Date().toISOString(), attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (!claim) continue;

    async function fail(reason: string, retryable = false) {
      failed++;
      const retry = retryable && row.attempts < 2;
      const delayMinutes = Math.min(60, 2 ** (row.attempts + 1));
      await sb.from('notification_outbox').update({
        status: retry ? 'queued' : 'failed', claimed_at: null,
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        last_error: reason.slice(0, 200),
      }).eq('id', row.id).eq('status', 'sending');
    }

    const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown> : {};
    const content = messageFor(row.topic, payload, appOrigin);
    let session = null;
    if (content && row.topic !== 'reflection_reminder') {
      const sessionId = Number(payload.session_id);
      const { data } = await sb.from('sessions')
        .select('mentor_id, mentee_id, status, scheduled_at').eq('id', sessionId).maybeSingle();
      session = data;
    }
    if (!content || !isDeliverable({ ...row, payload }, session)) {
      await fail('not_deliverable');
      continue;
    }

    // Where the member asked to be written to, falling back to the address
    // they sign in with. The two differ whenever the login is a placeholder or
    // an address they no longer control.
    const [{ data: profile }, { data: authUser }] = await Promise.all([
      sb.from('profiles').select('notification_email').eq('id', row.user_id).maybeSingle(),
      sb.auth.admin.getUserById(row.user_id),
    ]);
    const email = profile?.notification_email || authUser?.user?.email;
    if (!email) {
      await fail('recipient_email_missing');
      continue;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${resendKey}`,
          'content-type': 'application/json',
          'Idempotency-Key': row.idempotency_key,
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: content!.subject,
          text: content!.text,
        }),
      });
      if (!response.ok) {
        await fail(`resend_${response.status}`, [409, 429].includes(response.status) || response.status >= 500);
        continue;
      }
      sent++;
      await sb.from('notification_outbox').update({ status: 'sent', claimed_at: null, sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id).eq('status', 'sending');
    } catch {
      await fail('resend_network_error', true);
    }
  }
  return json({ sent, failed }, failed ? 502 : 200);
});
