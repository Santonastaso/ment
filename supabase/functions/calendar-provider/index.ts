import { corsHeaders, jsonError, jsonOk, requireUser } from '../_shared/index.ts';

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

async function signedState(userId: string, provider: Provider) {
  const payload = btoa(JSON.stringify({ userId, provider, expires: Date.now() + 10 * 60_000 })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);
  let ctx;
  try { ctx = await requireUser(req); } catch (response) { return response as Response; }
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');
    const provider = body.provider;

    if (action === 'status') {
      const { data } = await ctx.sb.from('calendar_connections').select('provider,provider_email,token_expires_at').eq('user_id', ctx.user.id);
      return jsonOk({ connections: data || [] });
    }
    if (!validProvider(provider)) return jsonError('calendar_provider_required');

    if (action === 'authorization_url') {
      const config = providerConfig(provider);
      const state = await signedState(ctx.user.id, provider);
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
      const connectionOwnerId = existingEvent?.owner_id || ctx.user.id;
      const { data: connection } = await ctx.sb.from('calendar_connections').select('*').eq('user_id', connectionOwnerId).eq('provider', provider).maybeSingle();
      if (!connection) return jsonError('calendar_not_connected', 409);
      const resolved = await accessToken(connection, provider);
      if (resolved.update) await ctx.sb.from('calendar_connections').update(resolved.update).eq('user_id', connectionOwnerId).eq('provider', provider);
      const participantIds = [session.mentor_id, session.mentee_id];
      const participants = await Promise.all(participantIds.map(async (id) => (await ctx.sb.auth.admin.getUserById(id)).data.user?.email || ''));
      const start = new Date(session.scheduled_at);
      const end = new Date(start.getTime() + Number(session.duration_minutes || 60) * 60_000);
      let externalEventId = ''; let joinUrl = ''; let htmlUrl = '';
      if (provider === 'google') {
        const googlePayload: Record<string, unknown> = { summary: session.title, description: session.pre_session_question || '', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, attendees: participants.filter(Boolean).map((email) => ({ email })) };
        if (!existingEvent) googlePayload.conferenceData = { createRequest: { requestId: `ment-${session.id}-${crypto.randomUUID()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
        const eventPath = existingEvent ? `/events/${encodeURIComponent(existingEvent.external_event_id)}` : '/events';
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary${eventPath}?conferenceDataVersion=1&sendUpdates=all`, { method: existingEvent ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${resolved.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(googlePayload) });
        if (!response.ok) throw new Error('calendar_event_create_failed');
        const event = await response.json(); externalEventId = event.id; joinUrl = event.hangoutLink || event.conferenceData?.entryPoints?.find((item: { entryPointType: string }) => item.entryPointType === 'video')?.uri || ''; htmlUrl = event.htmlLink || '';
      } else {
        const eventPath = existingEvent ? `/events/${encodeURIComponent(existingEvent.external_event_id)}` : '/events';
        const response = await fetch(`https://graph.microsoft.com/v1.0/me${eventPath}`, { method: existingEvent ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${resolved.token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' }, body: JSON.stringify({ subject: session.title, body: { contentType: 'text', content: session.pre_session_question || '' }, start: { dateTime: start.toISOString().replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: end.toISOString().replace('Z', ''), timeZone: 'UTC' }, attendees: participants.filter(Boolean).map((email) => ({ emailAddress: { address: email }, type: 'required' })), isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }) });
        if (!response.ok) throw new Error('calendar_event_create_failed');
        const event = await response.json(); externalEventId = event.id; joinUrl = event.onlineMeeting?.joinUrl || ''; htmlUrl = event.webLink || '';
      }
      await ctx.sb.from('calendar_events').upsert({ session_id: session.id, provider, owner_id: connectionOwnerId, external_event_id: externalEventId, join_url: joinUrl || null, html_url: htmlUrl || null, scheduled_for: session.scheduled_at, updated_at: new Date().toISOString() }, { onConflict: 'session_id,provider' });
      if (joinUrl) await ctx.sb.from('sessions').update({ meeting_url: joinUrl }).eq('id', session.id);
      return jsonOk({ provider, join_url: joinUrl, html_url: htmlUrl, event_id: externalEventId }, 201);
    }
    return jsonError('unsupported_action', 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'calendar_request_failed', 502);
  }
});
