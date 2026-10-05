import { adminClient, corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';

type Provider = 'google' | 'microsoft';
const validProvider = (value: unknown): value is Provider => value === 'google' || value === 'microsoft';
const appOrigin = () => String(Deno.env.get('APP_ORIGIN') || '').replace(/\/$/, '');

async function keyMaterial() {
  const secret = Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY') || '';
  if (secret.length < 32) throw new Error('calendar_not_configured');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', await keyMaterial(), 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...encrypted))}`;
}

async function decrypt(value: string) {
  const [ivPart, dataPart] = value.split('.');
  const decode = (part: string) => Uint8Array.from(atob(part), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', await keyMaterial(), 'AES-GCM', false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(ivPart) }, key, decode(dataPart));
  return new TextDecoder().decode(clear);
}

async function signedState(userId: string, provider: Provider, sessionId: number | null) {
  const payload = btoa(JSON.stringify({ userId, provider, sessionId, expires: Date.now() + 10 * 60_000 })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const key = await crypto.subtle.importKey('raw', await keyMaterial(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return `${payload}.${btoa(String.fromCharCode(...signature)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

async function verifyState(state: string, userId: string, provider: Provider) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;
  const normalize = (value: string) => value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const key = await crypto.subtle.importKey('raw', await keyMaterial(), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(normalize(signature)), (char) => char.charCodeAt(0)), new TextEncoder().encode(payload));
  if (!valid) return false;
  const parsed = JSON.parse(atob(normalize(payload)));
  return parsed.userId === userId && parsed.provider === provider && Number(parsed.expires) > Date.now();
}

function providerConfig(provider: Provider) {
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('calendar_provider_not_configured');
    return { clientId, clientSecret, tokenUrl: 'https://oauth2.googleapis.com/token' };
  }
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  const tenant = Deno.env.get('MICROSOFT_TENANT_ID') || 'common';
  if (!clientId || !clientSecret) throw new Error('calendar_provider_not_configured');
  return { clientId, clientSecret, tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, tenant };
}

async function exchangeCode(provider: Provider, code: string) {
  const config = providerConfig(provider);
  const params = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: `${appOrigin()}/calendar/callback`, grant_type: 'authorization_code' });
  if (provider === 'microsoft') params.set('scope', 'offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite');
  const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  if (!response.ok) throw new Error('calendar_authorization_failed');
  return response.json();
}

async function accessToken(connection: Record<string, unknown>, provider: Provider) {
  const expires = connection.token_expires_at ? new Date(String(connection.token_expires_at)).getTime() : 0;
  if (expires > Date.now() + 60_000) return { token: await decrypt(String(connection.token_ciphertext)), update: null };
  if (!connection.refresh_ciphertext) throw new Error('calendar_reconnect_required');
  const config = providerConfig(provider);
  const params = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: await decrypt(String(connection.refresh_ciphertext)), grant_type: 'refresh_token' });
  if (provider === 'microsoft') params.set('scope', 'offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite');
  const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  if (!response.ok) throw new Error('calendar_reconnect_required');
  const refreshed = await response.json();
  return { token: refreshed.access_token, update: { token_ciphertext: await encrypt(refreshed.access_token), refresh_ciphertext: refreshed.refresh_token ? await encrypt(refreshed.refresh_token) : connection.refresh_ciphertext, token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() } };
}

async function syncSessionEvents(sb: ReturnType<typeof adminClient>, sessionId: number, userId?: string) {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) return jsonError('invalid_session', 400);
  const { data: session, error: sessionError } = await sb.from('sessions').select('id,mentor_id,mentee_id,status,scheduled_at,duration_minutes,meeting_url').eq('id', sessionId).maybeSingle();
  if (sessionError || !session || (userId && ![session.mentor_id, session.mentee_id].includes(userId))) return jsonError('not_found', 404);
  const { data: events, error: eventsError } = await sb.from('calendar_events').select('*').eq('session_id', sessionId);
  if (eventsError) return jsonError('calendar_event_lookup_failed', 500);
  for (const event of events || []) {
    const eventProvider = event.provider as Provider;
    if (!validProvider(eventProvider)) return jsonError('calendar_provider_required');
    if (session.status === 'scheduled' && session.scheduled_at && new Date(event.scheduled_for).getTime() === new Date(session.scheduled_at).getTime()) continue;
    if (!['scheduled', 'cancelled', 'declined', 'expired'].includes(session.status)) continue;
    const { data: connection, error: connectionError } = await sb.from('calendar_connections').select('*').eq('user_id', event.owner_id).eq('provider', eventProvider).maybeSingle();
    if (connectionError || !connection) return jsonError('calendar_reconnect_required', 409);
    const resolved = await accessToken(connection, eventProvider);
    if (resolved.update) {
      const { error: updateError } = await sb.from('calendar_connections').update(resolved.update).eq('user_id', event.owner_id).eq('provider', eventProvider);
      if (updateError) return jsonError('calendar_connection_save_failed', 500);
    }
    const cancelled = session.status !== 'scheduled';
    const start = cancelled ? null : new Date(session.scheduled_at);
    const end = start ? new Date(start.getTime() + Number(session.duration_minutes || 60) * 60_000) : null;
    const endpoint = eventProvider === 'google'
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.external_event_id)}?sendUpdates=all`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(event.external_event_id)}`;
    const payload = cancelled ? null : eventProvider === 'google'
      ? { start: { dateTime: start!.toISOString() }, end: { dateTime: end!.toISOString() } }
      : { start: { dateTime: start!.toISOString().replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: end!.toISOString().replace('Z', ''), timeZone: 'UTC' } };
    const response = await fetch(endpoint, {
      method: cancelled ? 'DELETE' : 'PATCH',
      headers: { Authorization: `Bearer ${resolved.token}`, 'Content-Type': 'application/json' },
      ...(!cancelled && { body: JSON.stringify(payload) }),
    });
    if (!response.ok && !(cancelled && [404, 410].includes(response.status))) return jsonError('calendar_event_sync_failed', 502);
    if (cancelled) {
      const { error: deleteError } = await sb.from('calendar_events').delete().eq('id', event.id);
      if (deleteError) return jsonError('calendar_event_sync_failed', 500);
      if (session.meeting_url && session.meeting_url === event.join_url) {
        const { error: linkError } = await sb.from('sessions').update({ meeting_url: null }).eq('id', sessionId);
        if (linkError) return jsonError('calendar_event_sync_failed', 500);
      }
    } else {
      const { error: updateError } = await sb.from('calendar_events').update({ scheduled_for: session.scheduled_at, updated_at: new Date().toISOString() }).eq('id', event.id);
      if (updateError) return jsonError('calendar_event_sync_failed', 500);
    }
  }
  return jsonOk({ synced: (events || []).length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const serviceRequest = Boolean(serviceKey && req.headers.get('Authorization') === `Bearer ${serviceKey}`);
  let ctx!: Awaited<ReturnType<typeof requireUser>>;
  if (!serviceRequest) {
    try { ctx = await requireUser(req); } catch (response) { return response as Response; }
  }
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');
    const provider = body.provider;

    if (serviceRequest && action === 'drain_sync_queue') {
      const sb = adminClient();
      const { data: jobs, error } = await sb.rpc('claim_calendar_sync_jobs', { p_limit: 20 });
      if (error) return jsonError('calendar_job_claim_failed', 500);
      let synced = 0;
      let failed = 0;
      for (const job of jobs || []) {
        let failure = '';
        try {
          const response = await syncSessionEvents(sb, job.session_id);
          if (!response.ok) failure = (await response.json()).error || 'calendar_event_sync_failed';
        } catch (error) {
          failure = error instanceof Error ? error.message : 'calendar_event_sync_failed';
        }
        const current = sb.from('calendar_sync_jobs').delete()
          .eq('session_id', job.session_id).eq('generation', job.generation).eq('status', 'sending');
        if (!failure) {
          const { error: doneError } = await current;
          if (doneError) failed++;
          else synced++;
        } else {
          failed++;
          const delayMinutes = Math.min(60, 2 ** Math.min(job.attempts, 6));
          await sb.from('calendar_sync_jobs').update({
            status: job.attempts >= 8 ? 'failed' : 'queued', claimed_at: null,
            next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
            last_error: failure.slice(0, 200), updated_at: new Date().toISOString(),
          }).eq('session_id', job.session_id).eq('generation', job.generation).eq('status', 'sending');
        }
      }
      return failed ? new Response(JSON.stringify({ synced, failed }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }) : jsonOk({ synced, failed });
    }
    if (serviceRequest) return jsonError('unsupported_action', 400);

    if (action === 'status') {
      const { data, error } = await ctx.sb.from('calendar_connections').select('provider,provider_email,token_expires_at').eq('user_id', ctx.user.id);
      if (error) return jsonError('calendar_status_failed', 500);
      const providers = (['google', 'microsoft'] as Provider[]).filter(item => {
        try { providerConfig(item); return !!appOrigin() && (Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY') || '').length >= 32; }
        catch { return false; }
      });
      return jsonOk({ connections: data || [], providers });
    }
    if (action === 'sync_session_events') {
      return syncSessionEvents(ctx.sb, Number(body.session_id), ctx.user.id);
    }
    if (!validProvider(provider)) return jsonError('calendar_provider_required');

    if (action === 'authorization_url') {
      const config = providerConfig(provider);
      const sessionId = Number(body.session_id);
      const state = await signedState(ctx.user.id, provider, Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : null);
      const redirect = `${appOrigin()}/calendar/callback`;
      const url = provider === 'google'
        ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: config.clientId, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'openid email https://www.googleapis.com/auth/calendar.events', state })}`
        : `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize?${new URLSearchParams({ client_id: config.clientId, redirect_uri: redirect, response_type: 'code', response_mode: 'query', scope: 'offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite', state })}`;
      return jsonOk({ url });
    }

    if (action === 'exchange') {
      if (!await verifyState(String(body.state || ''), ctx.user.id, provider)) return jsonError('calendar_state_invalid', 403);
      const tokens = await exchangeCode(provider, String(body.code || ''));
      let providerEmail = '';
      const profileUrl = provider === 'google' ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName';
      const profileResponse = await fetch(profileUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (profileResponse.ok) { const profile = await profileResponse.json(); providerEmail = profile.email || profile.mail || profile.userPrincipalName || ''; }
      const { error } = await ctx.sb.from('calendar_connections').upsert({ user_id: ctx.user.id, provider, token_ciphertext: await encrypt(tokens.access_token), refresh_ciphertext: tokens.refresh_token ? await encrypt(tokens.refresh_token) : null, token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(), provider_email: providerEmail, scopes: String(tokens.scope || '').split(' ').filter(Boolean), updated_at: new Date().toISOString() });
      if (error) return jsonError('calendar_connection_save_failed', 500);
      return jsonOk({ connected: true, provider, provider_email: providerEmail });
    }

    if (action === 'create_event') {
      const sessionId = Number(body.session_id);
      const { data: session } = await ctx.sb.from('sessions').select('*').eq('id', sessionId).maybeSingle();
      if (!session || ![session.mentor_id, session.mentee_id].includes(ctx.user.id)) return jsonError('not_found', 404);
      if (session.status !== 'scheduled' || !session.scheduled_at) return jsonError('session_not_scheduled', 409);
      const { data: existingEvent } = await ctx.sb.from('calendar_events').select('*').eq('session_id', session.id).eq('provider', provider).maybeSingle();
      if (existingEvent?.scheduled_for && new Date(existingEvent.scheduled_for).getTime() === new Date(session.scheduled_at).getTime()) {
        return jsonOk({ provider, join_url: existingEvent.join_url, html_url: existingEvent.html_url, event_id: existingEvent.external_event_id, reused: true });
      }
      if (existingEvent && existingEvent.owner_id !== ctx.user.id) return jsonError('calendar_event_owner_only', 403);
      const connectionOwnerId = ctx.user.id;
      const { data: connection } = await ctx.sb.from('calendar_connections').select('*').eq('user_id', connectionOwnerId).eq('provider', provider).maybeSingle();
      if (!connection) return jsonError('calendar_not_connected', 409);
      const { data: leaseToken, error: leaseError } = await ctx.sb.rpc('claim_calendar_event', {
        p_session_id: session.id, p_provider: provider, p_owner_id: connectionOwnerId,
      });
      if (leaseError) return jsonError('calendar_event_claim_failed', 500);
      if (!leaseToken) return jsonError('calendar_creation_in_progress', 409);
      try {
      const resolved = await accessToken(connection, provider);
      if (resolved.update) await ctx.sb.from('calendar_connections').update(resolved.update).eq('user_id', connectionOwnerId).eq('provider', provider);
      const participantIds = [session.mentor_id, session.mentee_id];
      const participants = await Promise.all(participantIds.map(async (id) => (await ctx.sb.auth.admin.getUserById(id)).data.user?.email || ''));
      const start = new Date(session.scheduled_at);
      const end = new Date(start.getTime() + Number(session.duration_minutes || 60) * 60_000);
      let externalEventId = ''; let joinUrl = ''; let htmlUrl = '';
      if (provider === 'google') {
        const googlePayload: Record<string, unknown> = { summary: session.title, description: session.pre_session_question || '', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, attendees: participants.filter(Boolean).map((email) => ({ email })) };
        const stableEventId = `ment${session.id.toString(32)}`;
        if (!existingEvent) {
          googlePayload.id = stableEventId;
          googlePayload.conferenceData = { createRequest: { requestId: `ment-${session.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
        }
        const eventPath = existingEvent ? `/events/${encodeURIComponent(existingEvent.external_event_id)}` : '/events';
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary${eventPath}?conferenceDataVersion=1&sendUpdates=all`, { method: existingEvent ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${resolved.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(googlePayload) });
        const eventResponse = response.status === 409 && !existingEvent
          ? await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${stableEventId}`, { headers: { Authorization: `Bearer ${resolved.token}` } })
          : response;
        if (!eventResponse.ok) throw new Error('calendar_event_create_failed');
        const event = await eventResponse.json(); externalEventId = event.id; joinUrl = event.hangoutLink || event.conferenceData?.entryPoints?.find((item: { entryPointType: string }) => item.entryPointType === 'video')?.uri || ''; htmlUrl = event.htmlLink || '';
      } else {
        const eventPath = existingEvent ? `/events/${encodeURIComponent(existingEvent.external_event_id)}` : '/events';
        const response = await fetch(`https://graph.microsoft.com/v1.0/me${eventPath}`, { method: existingEvent ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${resolved.token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' }, body: JSON.stringify({ subject: session.title, body: { contentType: 'text', content: session.pre_session_question || '' }, start: { dateTime: start.toISOString().replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: end.toISOString().replace('Z', ''), timeZone: 'UTC' }, attendees: participants.filter(Boolean).map((email) => ({ emailAddress: { address: email }, type: 'required' })), isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', ...(!existingEvent && { transactionId: `ment-session-${session.id}` }) }) });
        if (!response.ok) throw new Error('calendar_event_create_failed');
        const event = response.status === 204 ? null : await response.json();
        externalEventId = event?.id || existingEvent?.external_event_id || '';
        joinUrl = event?.onlineMeeting?.joinUrl || existingEvent?.join_url || '';
        htmlUrl = event?.webLink || existingEvent?.html_url || '';
      }
      const { error: saveError } = await ctx.sb.from('calendar_events').upsert({ session_id: session.id, provider, owner_id: connectionOwnerId, external_event_id: externalEventId, join_url: joinUrl || null, html_url: htmlUrl || null, scheduled_for: session.scheduled_at, updated_at: new Date().toISOString() }, { onConflict: 'session_id,provider' });
      if (saveError) return jsonError('calendar_event_save_failed', 500);
      if (joinUrl) {
        const { error: linkError } = await ctx.sb.from('sessions').update({ meeting_url: joinUrl }).eq('id', session.id);
        if (linkError) return jsonError('calendar_event_save_failed', 500);
      }
      return jsonOk({ provider, join_url: joinUrl, html_url: htmlUrl, event_id: externalEventId }, 201);
      } finally {
        await ctx.sb.from('calendar_event_claims').delete()
          .eq('session_id', session.id).eq('provider', provider).eq('lease_token', leaseToken);
      }
    }
    return jsonError('unsupported_action', 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'calendar_request_failed', 502);
  }
});
