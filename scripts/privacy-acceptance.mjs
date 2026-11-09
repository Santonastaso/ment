#!/usr/bin/env node
// Manual production acceptance only. No existing-account discovery, invitations,
// public signup, provider calls, notification workers, or global cleanup RPCs.
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PREFIX = 'ment-privacy-acceptance-';
export const DOMAIN = 'privacy-acceptance.invalid';
export const CONFIRMATION = 'CREATE_AND_DELETE_SYNTHETIC_FIXTURES_ONLY';
export const fixtureEmail = (f, role) => `${PREFIX}${f.run.replaceAll('-', '')}-${role}@${DOMAIN}`;
const ensure = (ok) => { if (!ok) throw new Error('acceptance_failed'); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const CHECKS = ['deployed_ai_provider_boundary', 'export_v2', 'concurrent_cv_upload_withdrawal',
  'cv_withdrawal', 'member_erasure', 'admin_erasure', 'pending_scheduled_session_erasure', 'no_notifications'];
const SKIPS = ['browser_former_member_rendering'];

export function acceptanceArtifact(input, env) {
  // Rebuild every field. Never spread a report, environment, error, or payload
  // into an artifact or Markdown. Missing evidence is not a successful cleanup.
  const safe = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : 'unknown';
  const output = { schema: 'ment-privacy-acceptance-1', provisional: true, retention_days: 30,
    run_id: safe(env.GITHUB_RUN_ID, /^\d{1,24}$/), run_attempt: safe(env.GITHUB_RUN_ATTEMPT, /^\d{1,6}$/),
    commit: safe(env.GITHUB_SHA, /^[a-f0-9]{40}$/),
    execution_outcome: ['success', 'failure', 'cancelled', 'skipped'].includes(env.PRIVACY_EXECUTION_OUTCOME)
      ? env.PRIVACY_EXECUTION_OUTCOME : 'unknown',
    report_status: 'unavailable', result: 'unavailable', passed: [], skipped: [], failed: null, cleanup_errors: null };
  const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000;
  const list = (value, allowed) => Array.isArray(value) && value.length <= allowed.length &&
    value.every(x => allowed.includes(x)) && new Set(value).size === value.length;
  const stages = ['preflight', 'setup', ...CHECKS];
  if (!input || typeof input !== 'object' || !count(input.failed) || !count(input.cleanup_errors) ||
    !list(input.passed ?? [], CHECKS) || !list(input.skipped ?? [], SKIPS) ||
    (input.failed > 0 && !stages.includes(input.failed_stage))) return output;
  output.report_status = 'available';
  output.passed = [...(input.passed ?? [])]; output.skipped = [...(input.skipped ?? [])];
  output.failed = input.failed; output.cleanup_errors = input.cleanup_errors;
  if (input.failed > 0) output.failed_stage = input.failed_stage;
  const complete = CHECKS.every(name => output.passed.includes(name));
  output.result = input.failed || input.cleanup_errors || !complete || output.execution_outcome !== 'success'
    ? 'failed' : output.skipped.length ? 'passed_with_skips' : 'passed';
  return output;
}

export function acceptanceSummary(report) {
  return `### Synthetic privacy acceptance (provisional)\n\n` +
    `Run: ${report.run_id}, attempt: ${report.run_attempt}  \nCommit: ${report.commit}\n\n` +
    `Result: ${report.result}; report: ${report.report_status}; execution: ${report.execution_outcome}.  \n` +
    (report.failed_stage ? `Failed stage: ${report.failed_stage}.  \n` : '') +
    `Failed checks: ${report.failed ?? 'unknown'}; cleanup errors: ${report.cleanup_errors ?? 'unknown'}.\n\n` +
    `Passed: ${report.passed.join(', ') || 'none'}.  \nSkipped: ${report.skipped.join(', ') || 'not reported'}.\n\n` +
    `Sanitized JSON retained for 30 days. Missing report or cleanup evidence requires review.\n`;
}

async function publishAcceptanceReport() {
  let input;
  try {
    const text = await readFile(new URL('../privacy-acceptance-report.json', import.meta.url), 'utf8');
    if (text.length <= 16384) input = JSON.parse(text);
  } catch { /* Always publish sanitized missing-evidence status, never the error. */ }
  const report = acceptanceArtifact(input, process.env);
  const directory = new URL('../.privacy-acceptance/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('acceptance.json', directory), JSON.stringify(report, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, acceptanceSummary(report));
}

export function configuration(env, config) {
  ensure(env.PRIVACY_SYNTHETIC_CONFIRMATION === CONFIRMATION);
  ensure(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch');
  ensure(env.GITHUB_REF === 'refs/heads/main' && env.PRIVACY_ENVIRONMENT === 'production');
  const project = config.match(/^project_id = "([a-z0-9]+)"/m)?.[1];
  ensure(project && env.SUPABASE_URL === `https://${project}.supabase.co`);
  ensure(env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY);
  ensure(env.SUPABASE_ANON_KEY !== env.SUPABASE_SERVICE_ROLE_KEY);
  return { url: env.SUPABASE_URL, anon: env.SUPABASE_ANON_KEY, service: env.SUPABASE_SERVICE_ROLE_KEY };
}

export function fixture() {
  const run = randomUUID();
  const slug = PREFIX + run;
  return { run, org: { id: randomUUID(), name: slug, slug }, users: [], sessions: [], drafts: [] };
}

export function ownsUser(f, expected, user, profiles) {
  return uuid(expected.id) && f.users.includes(expected) && user?.id === expected.id &&
    expected.email === fixtureEmail(f, expected.role) &&
    user.app_metadata?.privacy_acceptance_run === f.run &&
    user.app_metadata?.privacy_acceptance_org === f.org.id &&
    (user.app_metadata?.organization_id === undefined || user.app_metadata.organization_id === f.org.id) &&
    (user.email === expected.email || (user.email === `erased-${expected.id}@erased.invalid` &&
      profiles.length === 1 && profiles[0].erased_at && profiles[0].name === 'Former member')) &&
    profiles.every(p => p.id === expected.id && p.organization_id === f.org.id);
}

export function ownsOrg(f, rows) {
  return uuid(f.org.id) && f.org.slug === PREFIX + f.run && rows.length === 1 &&
    rows[0].id === f.org.id && rows[0].slug === f.org.slug && rows[0].name === f.org.name;
}

export function client(config, transport = fetch) {
  return async (path, { method = 'GET', body, token = config.service, raw = false, allow = [] } = {}) => {
    // Hard network boundary, including redirects; never accept an arbitrary URL.
    ensure(/^\/(rest|auth|storage|functions)\/v1\//.test(path));
    ensure(!path.includes('..') && !path.includes('://'));
    if (path.startsWith('/functions/')) ensure(/^\/functions\/v1\/(withdraw-cv-consent|delete-account|profile-ingest|reflection-classify)$/.test(path));
    let response;
    try {
      response = await transport(config.url + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { apikey: token === config.service ? config.service : config.anon,
          Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'application/pdf' : 'application/json',
          Prefer: 'return=representation' },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      });
    } catch { throw new Error('request_failed'); }
    const data = await response.json().catch(() => null);
    if (!response.ok && !allow.includes(response.status)) {
      // Preserve only the one safe machine-readable reason needed by the
      // concurrency check. Never copy server bodies, identifiers or URLs.
      const failure = new Error('request_failed');
      failure.category = [data?.message, data?.error, data?.code].includes('cv_consent_required')
        ? 'cv_consent_required' : 'http_error';
      throw failure;
    }
    return { status: response.status, data };
  };
}

export async function verifyErasedSession(api, session, peer) {
  // Match the application's participant read path. Column grants deliberately
  // prohibit SELECT * (including private notes) with an authenticated JWT.
  const { data: visible } = await api('/rest/v1/rpc/my_session', {
    method: 'POST', body: { p_session_id: session.id }, token: peer.token,
  });
  ensure(visible?.id === session.id && visible.mentor_id === peer.id && visible.mentee_id === session.mentee_id);
  ensure(visible.reflection === '' && visible.mentee_rating === null &&
    visible.mentor_reflection === 'synthetic-peer-reflection' && visible.mentor_rating === 3);
  // RPC redaction alone cannot prove deletion of the erased person's raw note.
  // Use the service role separately, with only the columns this check needs.
  const { data: raw } = await api(`/rest/v1/sessions?id=eq.${session.id}&mentor_id=eq.${peer.id}&mentee_id=eq.${session.mentee_id}` +
    '&select=id,reflection,mentee_rating,mentor_reflection,mentor_rating,outbound_message,pre_session_question');
  ensure(raw.length === 1 && raw[0].id === session.id && raw[0].reflection === '' && raw[0].mentee_rating === null &&
    raw[0].outbound_message === '' && raw[0].pre_session_question === '' &&
    raw[0].mentor_reflection === 'synthetic-peer-reflection' && raw[0].mentor_rating === 3);
}

// Safety comes from avoiding enqueue conditions, not from racing the mail worker
// to delete queued messages. Completed, unscheduled sessions do not enqueue mail;
// reflection reminders are disabled and no calendar connections are created.
export async function runAcceptance(config, { transport = fetch } = {}) {
  const f = fixture();
  const api = client(config, transport);
  const rows = async path => (await api(`/rest/v1/${path}`)).data;
  const insert = async (table, body) => (await api(`/rest/v1/${table}`, { method: 'POST', body })).data;
  const rpc = async (name, body, token) => (await api(`/rest/v1/rpc/${name}`, { method: 'POST', body, token })).data;
  const report = { passed: [], failed: 0, cleanup_errors: 0, skipped: ['browser_former_member_rendering'] };
  let stage = 'setup';
  const check = name => { report.passed.push(name); };
  const verifyUser = async u => {
    ensure(ownsOrg(f, await rows(`organizations?id=eq.${f.org.id}&select=id,name,slug`)));
    const result = await api(`/auth/v1/admin/users/${u.id}`, { allow: [404] });
    const profiles = await rows(`profiles?id=eq.${u.id}&select=id,organization_id,name,erased_at`);
    if (result.status === 404) { ensure(profiles.length === 0); return false; }
    ensure(ownsUser(f, u, result.data, profiles));
    return true;
  };
  const paths = u => [`${u.id}/${f.org.slug}.pdf`, `${u.id}/nested/${f.org.slug}.pdf`];
  const upload = (u, path) => api(`/storage/v1/object/profile-uploads/${path}`, {
    method: 'POST', body: Buffer.from('%PDF-1.4\n% synthetic privacy acceptance\n%%EOF'), raw: true, token: u.token,
  });
  const noUploads = async u => {
    for (const prefix of [u.id, `${u.id}/nested`]) {
      const { data } = await api('/storage/v1/object/list/profile-uploads', {
        method: 'POST', body: { prefix, limit: 100, offset: 0 },
      });
      ensure(Array.isArray(data) && data.every(x => x.id === null && x.name === 'nested'));
    }
  };
  try {
    // Plain INSERT only; collisions fail. Never upsert/reuse any fixture.
    f.orgAttempted = true;
    await insert('organizations', f.org);
    for (const role of ['member', 'peer', 'target', 'admin']) {
      const u = { id: randomUUID(), role, email: fixtureEmail(f, role),
        password: randomBytes(32).toString('base64url') + 'aA1!' };
      f.users.push(u); // Track before the request, including ambiguous timeouts.
      const { data } = await api('/auth/v1/admin/users', { method: 'POST', body: {
        id: u.id, email: u.email, password: u.password, email_confirm: true,
        // No trusted organization yet: handle_new_user leaves this Auth row
        // profile-less. Insert the profile with reminders OFF atomically below,
        // avoiding even a short cron window with the default reminders=true.
        app_metadata: { privacy_acceptance_org: f.org.id, privacy_acceptance_run: f.run },
        user_metadata: { name: f.org.slug + '-' + role },
      } });
      ensure(data?.id === u.id);
      ensure(await verifyUser(u));
      const profile = { name: f.org.slug + '-' + role, organization_id: f.org.id,
        admin_scope: role === 'admin' ? 'org' : 'none', is_admin: role === 'admin',
        onboarding_complete: true, ai_opt_out: true, reflection_email_reminders: false,
        mentorship_paused: false };
      ensure((await rows(`profiles?id=eq.${u.id}&select=id`)).length === 0);
      await insert('profiles', { id: u.id, ...profile });
      await api(`/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: { app_metadata: {
        organization_id: f.org.id, admin_scope: profile.admin_scope,
        privacy_acceptance_org: f.org.id, privacy_acceptance_run: f.run,
      } } });
      ensure(await verifyUser(u));
      const login = await api('/auth/v1/token?grant_type=password', { method: 'POST', token: config.anon,
        body: { email: u.email, password: u.password } });
      ensure(login.data?.user?.id === u.id && login.data.access_token);
      u.token = login.data.access_token;
    }
    const [member, peer, target, admin] = f.users;
    stage = 'deployed_ai_provider_boundary';
    const memberReflection = (await insert('reflection_logs', {
      user_id: member.id, support_needed: 'synthetic-private-gap', managed_well: 'synthetic-private-strength',
    }))[0];
    const aiRunsBefore = await rows(`ai_runs?user_id=eq.${member.id}&select=id`);
    const ingestBlocked = await api('/functions/v1/profile-ingest', {
      method: 'POST', body: { storage_path: `${member.id}/must-not-be-read.pdf`, lang: 'en' },
      token: member.token, allow: [403],
    });
    ensure(ingestBlocked.status === 403 && ingestBlocked.data?.error === 'ai_opted_out');
    const reflectionSkipped = await api('/functions/v1/reflection-classify', {
      method: 'POST', body: { reflection_log_id: memberReflection.id, lang: 'en' }, token: member.token,
    });
    ensure(reflectionSkipped.data?.id === memberReflection.id && reflectionSkipped.data?.skipped === 'ai_opted_out' &&
      Array.isArray(reflectionSkipped.data.extracted_gaps) && reflectionSkipped.data.extracted_gaps.length === 0 &&
      Array.isArray(reflectionSkipped.data.extracted_strengths) && reflectionSkipped.data.extracted_strengths.length === 0);
    ensure((await rows(`ai_runs?user_id=eq.${member.id}&select=id`)).length === aiRunsBefore.length);
    check(stage);

    stage = 'export_v2';
    for (const u of [member, peer, target]) {
      await rpc('record_consent', { p_purpose: 'ai_profile_import', p_text_version: 'synthetic-acceptance-v1', p_locale: 'en' }, u.token);
      const drafts = await insert('profile_drafts', { user_id: u.id, source: 'cv', raw_text: f.org.slug + u.role, proposed_json: {} });
      f.drafts.push({ id: drafts[0].id, user_id: u.id });
      for (const path of paths(u)) await upload(u, path);
    }
    for (const u of [member, target]) {
      for (const status of ['completed', 'pending', 'scheduled']) {
        // Pending is inserted as completed and changed directly so this synthetic
        // check cannot enqueue a request email. Scheduled is >24h away, outside
        // the reminder window, and no calendar connection exists.
        const initialStatus = status === 'pending' ? 'completed' : status;
        const scheduledAt = status === 'scheduled' ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null;
        const session = (await insert('sessions', { mentor_id: peer.id, mentee_id: u.id,
          title: `${f.org.slug}-${status}`, status: initialStatus, scheduled_at: scheduledAt,
          reflection: 'synthetic-own-reflection', mentor_reflection: 'synthetic-peer-reflection',
          outbound_message: 'synthetic-request', pre_session_question: 'synthetic-question',
          topics: ['synthetic-hidden-topic'], mentee_rating: 5, mentor_rating: 3 }))[0];
        if (status === 'pending') await api(`/rest/v1/sessions?id=eq.${session.id}`, { method: 'PATCH', body: { status } });
        f.sessions.push({ id: session.id, mentor_id: peer.id, mentee_id: u.id, status });
        await insert('session_messages', [{ session_id: session.id, sender_id: u.id, body: 'synthetic-own-message' },
          { session_id: session.id, sender_id: peer.id, body: 'synthetic-peer-message' }]);
      }
    }
    await insert('discovery_threads', { user_id: member.id, turns: [
      { role: 'user', content: 'synthetic-search', matches: [{ name: 'synthetic-hidden-snapshot' }] },
      { role: 'assistant', content: 'synthetic-hidden-suggestion' }] });
    const exported = await rpc('export_my_data', {}, member.token);
    ensure(exported?.format === 'ment-export-2' && exported.profile.id === member.id);
    ensure(exported.auth_account.email === member.email && exported.profile_drafts.length === 1);
    ensure(exported.sessions.length === 3 && exported.sessions.every(s => s.reflection === 'synthetic-own-reflection'));
    ensure(exported.session_messages_sent.length === 3 && exported.session_messages_sent.every(m => m.body === 'synthetic-own-message'));
    ensure(exported.discovery_threads.length === 1 && exported.discovery_threads[0].messages_sent.length === 1 &&
      exported.discovery_threads[0].messages_sent[0].content === 'synthetic-search');
    for (const session of exported.sessions) for (const key of ['mentor_reflection', 'mentor_rating', 'route_token', 'meeting_url', 'topics', 'idempotency_key'])
      ensure(!(key in session));
    for (const sentinel of ['synthetic-peer-reflection', 'synthetic-hidden-snapshot', 'synthetic-hidden-suggestion', peer.email])
      ensure(!JSON.stringify(exported).includes(sentinel));
    check(stage);
    stage = 'concurrent_cv_upload_withdrawal';
    const racePaths = Array.from({ length: 8 }, (_, index) => `${member.id}/race-${index}-${f.run}.pdf`);
    const raceUpload = async path => {
      try {
        await upload(member, path);
        return 'uploaded';
      } catch (error) {
        if (error?.category === 'cv_consent_required') return 'consent_rejected';
        throw error;
      }
    };
    const race = await Promise.all([
      ...racePaths.map(raceUpload),
      api('/functions/v1/withdraw-cv-consent', { method: 'POST', body: {}, token: member.token }),
    ]);
    const uploadOutcomes = race.slice(0, racePaths.length);
    ensure(uploadOutcomes.length === racePaths.length &&
      uploadOutcomes.every(outcome => outcome === 'uploaded' || outcome === 'consent_rejected'));
    // A second idempotent pass closes any upload that was already authorized
    // while withdrawal was waiting on the consent row lock.
    const settled = await api('/functions/v1/withdraw-cv-consent', { method: 'POST', body: {}, token: member.token });
    ensure(settled.data?.cleanup_complete === true && Number.isInteger(settled.data.uploads_removed));
    await noUploads(member);
    check(stage);

    stage = 'cv_withdrawal';
    for (let attempt = 0; attempt < 2; attempt++) {
      ensure(await verifyUser(member));
      const { data } = await api('/functions/v1/withdraw-cv-consent', { method: 'POST', body: {}, token: member.token });
      ensure(data?.cleanup_complete === true && Number.isInteger(data.uploads_removed) && data.uploads_removed >= 0);
      ensure(Number.isInteger(data.withdrawn) && data.withdrawn === 0);
    }
    ensure((await rows(`profile_drafts?user_id=eq.${member.id}&source=eq.cv&select=id`)).length === 0);
    const consents = await rows(`consent_records?user_id=eq.${member.id}&purpose=eq.ai_profile_import&select=withdrawn_at`);
    ensure(consents.length > 0 && consents.every(c => c.withdrawn_at));
    await noUploads(member);
    // Probe the DB guard without calling AI. Roll back unexpected successful writes in finally.
    const rejected = await api('/rest/v1/profile_drafts', { method: 'POST', token: config.service,
      body: { user_id: member.id, source: 'cv', proposed_json: {} }, allow: [400, 403, 409, 500] });
    ensure(rejected.status >= 400 && rejected.data?.message === 'cv_consent_required');
    const rejectedUpload = await api(`/storage/v1/object/profile-uploads/${paths(member)[0]}`, {
      method: 'POST', body: Buffer.from('%PDF-1.4\n%%EOF'), raw: true, token: member.token, allow: [400, 403, 500],
    });
    ensure(rejectedUpload.status >= 400);
    await noUploads(member);
    const peerExport = await rpc('export_my_data', {}, peer.token);
    ensure(peerExport.profile_drafts.length === 1 && peerExport.consents.some(c => !c.withdrawn_at));
    ensure(peerExport.format === 'ment-export-2' && peerExport.auth_account.email === peer.email && peerExport.sessions.length === 6);
    for (const session of peerExport.sessions) {
      ensure(session.mentor_reflection === 'synthetic-peer-reflection');
      for (const key of ['reflection', 'mentee_rating', 'title', 'outbound_message', 'pre_session_question', 'topics', 'meeting_url', 'route_token'])
        ensure(!(key in session));
    }
    ensure(peerExport.session_messages_sent.length === 6 && peerExport.session_messages_sent.every(m => m.body === 'synthetic-peer-message'));
    for (const path of paths(peer)) {
      const listed = await api('/storage/v1/object/list/profile-uploads', { method: 'POST', body: {
        prefix: path.slice(0, path.lastIndexOf('/')), search: path.split('/').at(-1), limit: 100 } });
      ensure(listed.data.some(x => x.name === path.split('/').at(-1) && x.id));
    }
    check(stage);
    for (const u of [member, target]) {
      stage = u === member ? 'member_erasure' : 'admin_erasure';
      ensure(await verifyUser(u));
      const erased = await api('/functions/v1/delete-account', { method: 'POST',
        body: u === member ? { confirm: 'DELETE' } : { user_id: u.id }, token: u === member ? u.token : admin.token });
      ensure(erased.data?.erased === true);
      const p = (await rows(`profiles?id=eq.${u.id}&select=*`))[0];
      ensure(p?.name === 'Former member' && p.erased_at && p.deactivated_at && p.ai_opt_out && !p.onboarding_complete);
      const auth = (await api(`/auth/v1/admin/users/${u.id}`)).data;
      ensure(auth.email === `erased-${u.id}@erased.invalid` && Date.parse(auth.banned_until) > Date.now());
      const denied = await api('/auth/v1/token?grant_type=password', { method: 'POST', token: config.anon,
        body: { email: u.email, password: u.password }, allow: [400, 401, 403] });
      ensure([400, 401, 403].includes(denied.status));
      const oldToken = await api('/functions/v1/withdraw-cv-consent', { method: 'POST', body: {}, token: u.token, allow: [401, 403] });
      ensure([401, 403].includes(oldToken.status));
      const staleConsent = await api('/rest/v1/rpc/record_consent', {
        method: 'POST', token: u.token, allow: [400, 403],
        body: { p_purpose: 'terms_privacy', p_text_version: 'synthetic-acceptance-v1', p_locale: 'en' },
      });
      ensure([400, 403].includes(staleConsent.status) && staleConsent.data?.message === 'account_deactivated');
      await noUploads(u);
      for (const table of ['profile_drafts', 'consent_records', 'discovery_threads'])
        ensure((await rows(`${table}?user_id=eq.${u.id}&select=id`)).length === 0);
      const shared = f.sessions.filter(s => s.mentee_id === u.id);
      ensure(shared.length === 3);
      for (const session of shared) {
        await verifyErasedSession(api, session, peer);
        const messages = await rows(`session_messages?session_id=eq.${session.id}&select=sender_id,body`);
        ensure(messages.length === 1 && messages[0].sender_id === peer.id && messages[0].body === 'synthetic-peer-message');
      }
      check(stage);
    }
    stage = 'pending_scheduled_session_erasure';
    for (const session of f.sessions.filter(s => s.status !== 'completed')) {
      const rowsAfter = await rows(`sessions?id=eq.${session.id}&select=status,outbound_message,pre_session_question`);
      ensure(rowsAfter.length === 1 && rowsAfter[0].status === 'cancelled' && rowsAfter[0].outbound_message === '' && rowsAfter[0].pre_session_question === '');
    }
    check(stage);
    stage = 'no_notifications';
    ensure((await rows(`notification_outbox?user_id=in.(${f.users.map(u => u.id).join(',')})&select=id`)).length === 0);
    check(stage);
  } catch { report.failed++; report.failed_stage = stage; }
  finally {
    // No list-users, email search, prefix wildcard deletes, or cross-run recovery.
    // Every deletion is based on this process's newly created ID + exact markers.
    const cleanup = async fn => { try { await fn(); } catch { report.cleanup_errors++; } };
    const owned = new Set();
    for (const u of f.users) await cleanup(async () => { if (await verifyUser(u)) owned.add(u.id); });
    // Service-role audit actors can be NULL. Remove only exact targets created
    // by this invocation, with a freshly verified fixture owner.
    const targets = [
      ...f.users.map(u => ({ table: 'profiles', id: u.id, owner: u.id })),
      ...f.drafts.map(d => ({ table: 'profile_drafts', id: d.id, owner: d.user_id })),
      ...f.sessions.map(s => ({ table: 'sessions', id: s.id, owner: s.mentee_id })),
    ];
    for (const target of targets) if (owned.has(target.owner)) await cleanup(async () => {
      ensure(await verifyUser(f.users.find(u => u.id === target.owner)));
      await api(`/rest/v1/audit_logs?target_type=eq.${target.table}&target_id=eq.${target.id}`, { method: 'DELETE' });
    });
    for (const s of f.sessions) await cleanup(async () => {
      ensure(owned.has(s.mentor_id) && owned.has(s.mentee_id));
      const q = `sessions?id=eq.${s.id}&mentor_id=eq.${s.mentor_id}&mentee_id=eq.${s.mentee_id}`;
      ensure((await rows(q + '&select=id')).length === 1);
      await api(`/rest/v1/${q}`, { method: 'DELETE' });
    });
    for (const u of f.users) if (owned.has(u.id)) await cleanup(async () => {
      ensure(await verifyUser(u));
      await api('/storage/v1/object/profile-uploads', { method: 'DELETE', body: { prefixes: paths(u) } });
      // Stop before Auth cascade if any unexpected counterpart or storage remains.
      await noUploads(u);
      ensure((await rows(`sessions?or=(mentor_id.eq.${u.id},mentee_id.eq.${u.id})&select=id`)).length === 0);
      await api(`/rest/v1/audit_logs?actor_id=eq.${u.id}`, { method: 'DELETE' });
      await api(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
      ensure(!await verifyUser(u));
    });
    if (f.orgAttempted) await cleanup(async () => {
      const orgs = await rows(`organizations?id=eq.${f.org.id}&select=id,name,slug`);
      if (!orgs.length) return;
      ensure(ownsOrg(f, orgs));
      ensure((await rows(`profiles?organization_id=eq.${f.org.id}&select=id`)).length === 0);
      // Preserve the org marker when any tracked Auth cleanup is incomplete.
      for (const u of f.users) ensure((await api(`/auth/v1/admin/users/${u.id}`, { allow: [404] })).status === 404);
      await api(`/rest/v1/organizations?id=eq.${f.org.id}&slug=eq.${f.org.slug}&name=eq.${f.org.name}`, { method: 'DELETE' });
      ensure((await rows(`organizations?id=eq.${f.org.id}&select=id`)).length === 0);
    });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    ensure(process.argv.length === 3 && ['--execute', '--summarize'].includes(process.argv[2]));
    if (process.argv[2] === '--summarize') {
      await publishAcceptanceReport();
    } else {
      const config = configuration(process.env, await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'));
      const report = await runAcceptance(config);
      console.log(JSON.stringify(report));
      process.exitCode = report.failed || report.cleanup_errors ? 1 : 0;
    }
  } catch {
    console.log(JSON.stringify({ failed: 1, failed_stage: 'preflight', cleanup_errors: 0 }));
    process.exitCode = 1;
  }
}
