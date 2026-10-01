// Admin: bulk-import employees from a CSV/XLSX file uploaded to the
// 'imports' Storage bucket. Replaces the legacy /api/admin/upload route.
//
// Body: { storage_path: string, mode: 'insert' | 'update' | 'upsert' }
// Returns one-time, per-user credentials for newly imported accounts.

import { read as xlsxRead, utils as xlsxUtils } from 'npm:xlsx@0.18.5';
import {
  corsHeaders,
  generateTempPassword,
  jsonError,
  jsonOk,
  requireAdmin,
} from '../_shared/index.ts';

const VALID_SENIORITIES = ['junior', 'mid', 'senior', 'lead'];
const VALID_PERSONAS = ['student', 'alumnus'];
const IMPORT_MODES = ['insert', 'update', 'upsert'];

function normRow(row: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.trim().toLowerCase().replace(/\s+/g, '_')] = String(v ?? '').trim();
  }
  return out;
}

function parseSkillList(s: string): string[] {
  return (s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

async function createSingleMember(ctx: Awaited<ReturnType<typeof requireAdmin>>, body: Record<string, unknown>) {
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
    return jsonError('valid_email_and_name_required');
  }
  const organizationId = ctx.profile.organization_id;
  if (!organizationId) return jsonError('organization_required', 403);

  const { data: foundId, error: lookupError } = await ctx.sb.rpc('admin_auth_user_id_by_email', { p_email: email });
  if (lookupError) return jsonError('account_lookup_failed', 500);

  let userId = foundId as string | null;
  let created = false;
  const tempPassword = generateTempPassword();
  if (!userId) {
    const { data, error } = await ctx.sb.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error || !data.user) {
      const { data: racedId } = await ctx.sb.rpc('admin_auth_user_id_by_email', { p_email: email });
      if (!racedId) {
        const alreadyExists = error?.message?.toLowerCase().includes('already') || false;
        return jsonError(alreadyExists ? 'account_already_exists' : 'account_create_failed', alreadyExists ? 409 : 500);
      }
      userId = racedId as string;
    } else {
      userId = data.user.id;
      created = true;
    }
  }

  let existingAppMetadata: Record<string, unknown> = {};
  if (!created) {
    const { data: existingAuth, error: existingAuthError } = await ctx.sb.auth.admin.getUserById(userId);
    if (existingAuthError || !existingAuth.user) return jsonError('account_lookup_failed', 500);
    existingAppMetadata = existingAuth.user.app_metadata || {};
    const existingScope = String(existingAppMetadata.admin_scope || 'none');
    const existingOrganization = String(existingAppMetadata.organization_id || '');
    if (existingScope !== 'none' || (existingOrganization && existingOrganization !== organizationId)) {
      return jsonError('account_not_attachable', 409);
    }
  }
  const appMetadata = {
    ...existingAppMetadata,
    organization_id: organizationId,
    admin_scope: 'none',
    ...(created ? { must_change_password: true } : {}),
  };
  const { error: metadataError } = await ctx.sb.auth.admin.updateUserById(userId, { app_metadata: appMetadata });
  if (metadataError) {
    if (created) await ctx.sb.auth.admin.deleteUser(userId);
    return jsonError('trusted_metadata_update_failed', 500);
  }

  const { error: profileError } = await ctx.sb.rpc('admin_provision_member', {
    p_user_id: userId,
    p_organization_id: organizationId,
    p_profile: {
      name,
      department: String(body.department || ''),
      seniority: String(body.seniority || 'junior'),
      job_title: String(body.job_title || ''),
      program: String(body.program || ''),
      cohort_year: body.cohort_year ? String(body.cohort_year) : '',
      role: ['student', 'alumnus'].includes(String(body.role)) ? body.role : 'student',
      location: String(body.location || ''),
      linkedin_url: String(body.linkedin_url || ''),
      linkedin_headline: String(body.linkedin_headline || ''),
      onboarding_complete: false,
      must_change_password: created,
    },
  });
  if (profileError) {
    if (created) await ctx.sb.auth.admin.deleteUser(userId);
    else await ctx.sb.auth.admin.updateUserById(userId, { app_metadata: existingAppMetadata });
    const alreadyExists = /member_profile_exists|member_scope_mismatch/.test(profileError.message);
    return jsonError(alreadyExists ? 'member_already_provisioned' : 'member_profile_create_failed', alreadyExists ? 409 : 500);
  }

  const { error: auditError } = await ctx.sb.from('audit_logs').insert({
    actor_id: ctx.user.id,
    action: 'admin.user_provisioned',
    target_type: 'profile',
    target_id: userId,
    metadata: { email, organization_id: organizationId, created },
  });
  if (auditError) console.error('member provisioning audit failed', userId, auditError.message);

  return jsonOk({ email, created, attached: !created, temp_password: created ? tempPassword : null }, 201);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireAdmin(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({}));
  if (body.action === 'create_single') return createSingleMember(ctx, body);
  const storagePath = (body.storage_path || '').toString();
  const mode = IMPORT_MODES.includes(body.mode) ? body.mode : 'insert';
  if (!storagePath) return jsonError('storage_path_required');
  if (!storagePath.startsWith(`${ctx.user.id}/`)) return jsonError('forbidden', 403);

  const { data: file, error: dlErr } = await ctx.sb.storage
    .from('imports')
    .download(storagePath);
  if (dlErr || !file) return jsonError(`download_failed: ${dlErr?.message ?? 'unknown'}`, 400);

  let rows: Record<string, unknown>[];
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = xlsxRead(buf, { type: 'array' });
    rows = xlsxUtils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch (e) {
    return jsonError(`parse_failed: ${(e as Error).message}`, 400);
  }
  if (!rows.length) return jsonError('empty_file', 400);

  const tempPasswords: { email: string; password: string }[] = [];
  const adminOrgId = ctx.profile.organization_id;
  if (!adminOrgId) return jsonError('organization_required', 403);
  const isPlatformAdmin = ctx.profile.admin_scope === 'platform';
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const managerLinks: { userId: string; email: string; memberEmail: string; organizationId: string; row: number }[] = [];
  const touchedIds: string[] = [];
  const failures: { row: number; email: string; error: string }[] = [];
  const createdUserIds = new Set<string>();

  const normalizedRows = rows.map(normRow);
  const requestedEmails = [...new Set(normalizedRows.flatMap((row) => [
    row.email?.toLowerCase(), (row.manager_email || row.manager || '').toLowerCase(),
  ]).filter((email): email is string => Boolean(email)))];
  const { data: authUsers, error: usersError } = await ctx.sb.rpc('admin_auth_users_by_email', { p_emails: requestedEmails });
  if (usersError) return jsonError('user_lookup_failed', 500);
  const usersByEmail = new Map<string, { id: string; email: string }>((authUsers || []).map((user: { email: string; user_id: string }) => [
    user.email.toLowerCase(), { id: user.user_id, email: user.email },
  ] as [string, { id: string; email: string }]));

  for (const [rowIndex, r] of normalizedRows.entries()) {
    const email = (r.email || '').toLowerCase();
    const name = r.name || r.full_name || '';
    if (!email || !name) { skipped++; continue; }

    const department = r.department || '';
    const job_title = r.current_role || r.role || r.job_title || '';
    const seniority = VALID_SENIORITIES.includes(r.seniority) ? r.seniority : 'junior';
    const program = r.program || '';
    const cohort_year = parseInt(r.cohort_year || '', 10) || null;
    const persona = VALID_PERSONAS.includes(r.persona) ? r.persona : 'student';
    const tenure_years = parseInt(r.tenure_years || '0', 10) || 0;
    const location = r.location || '';
    const manager_email = (r.manager_email || r.manager || '').toLowerCase();
    const can_teach = parseSkillList(r.can_teach);
    const wants_to_learn = parseSkillList(r.wants_to_learn);
    const linkedin_url = r.linkedin_url || '';
    const linkedin_headline = r.linkedin_headline || '';
    const external_source = r.external_source || (r.essec_id ? 'essec' : '');
    const external_id = r.external_id || r.essec_id || '';

    let userId = usersByEmail.get(email)?.id;
    let profileOrganizationId = adminOrgId;
    let generatedPassword: string | null = null;
    let createdAuthThisRow = false;
    let restoreAppMetadata: Record<string, unknown> | null = null;

    if (userId) {
      if (mode === 'insert') { skipped++; continue; }
      const { data: existingProfile, error: profileLookupError } = await ctx.sb
        .from('profiles')
        .select('organization_id, admin_scope')
        .eq('id', userId)
        .maybeSingle();
      if (profileLookupError) {
        failures.push({ row: rowIndex + 2, email, error: 'profile_lookup_failed' });
        skipped++;
        continue;
      }
      if (existingProfile && existingProfile.admin_scope !== 'none') { skipped++; continue; }
      if (existingProfile && !isPlatformAdmin && existingProfile.organization_id !== adminOrgId) { skipped++; continue; }
      profileOrganizationId = existingProfile?.organization_id || adminOrgId;
      if (!existingProfile) {
        const { data: authAccount, error: authLookupError } = await ctx.sb.auth.admin.getUserById(userId);
        if (authLookupError || !authAccount.user) {
          failures.push({ row: rowIndex + 2, email, error: 'auth_user_lookup_failed' });
          skipped++;
          continue;
        }
        restoreAppMetadata = authAccount.user.app_metadata || {};
        const existingScope = String(restoreAppMetadata.admin_scope || 'none');
        const existingOrganization = String(restoreAppMetadata.organization_id || '');
        if (existingScope !== 'none' || (existingOrganization && existingOrganization !== adminOrgId)) {
          failures.push({ row: rowIndex + 2, email, error: 'account_not_attachable' });
          skipped++;
          continue;
        }
        const { error: metadataError } = await ctx.sb.auth.admin.updateUserById(userId, {
          app_metadata: { ...restoreAppMetadata, organization_id: adminOrgId, admin_scope: 'none' },
        });
        if (metadataError) {
          failures.push({ row: rowIndex + 2, email, error: 'trusted_metadata_update_failed' });
          skipped++;
          continue;
        }
      }
    } else {
      if (mode === 'update') { skipped++; continue; }
      generatedPassword = generateTempPassword();
      const { data, error } = await ctx.sb.auth.admin.createUser({
        email,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { name, department, seniority, job_title, tenure_years, location },
      });
      if (error || !data.user) {
        console.warn('createUser failed', email, error?.message);
        skipped++;
        failures.push({ row: rowIndex + 2, email, error: error?.message || 'user_create_failed' });
        continue;
      }
      userId = data.user.id;
      createdAuthThisRow = true;
      const { error: metadataError } = await ctx.sb.auth.admin.updateUserById(userId, {
        app_metadata: { organization_id: adminOrgId, admin_scope: 'none', must_change_password: true },
      });
      if (metadataError) {
        await ctx.sb.auth.admin.deleteUser(userId);
        failures.push({ row: rowIndex + 2, email, error: 'trusted_metadata_update_failed' });
        skipped++;
        continue;
      }
      usersByEmail.set(email, { id: userId, email });
    }

    const isNewMember = createdAuthThisRow || createdUserIds.has(userId);
    const profile: Record<string, unknown> = {
      name, department, seniority, job_title, program, cohort_year, role: persona,
      tenure_years, location, linkedin_url, linkedin_headline,
      external_source: external_source || null, external_id: external_id || null,
      source_synced_at: external_source ? new Date().toISOString() : null,
      onboarding_complete: isNewMember,
      must_change_password: isNewMember,
    };
    const replaceSkills = can_teach.length > 0 || wants_to_learn.length > 0;
    const { error: provisionError } = await ctx.sb.rpc('admin_provision_member', {
      p_user_id: userId,
      p_organization_id: profileOrganizationId,
      p_profile: profile,
      p_skills: { can_teach, wants_to_learn },
      p_replace_skills: replaceSkills,
      p_allow_update: true,
    });
    if (provisionError) {
      if (createdAuthThisRow) {
        await ctx.sb.auth.admin.deleteUser(userId);
        usersByEmail.delete(email);
      } else if (restoreAppMetadata) await ctx.sb.auth.admin.updateUserById(userId, { app_metadata: restoreAppMetadata });
      failures.push({ row: rowIndex + 2, email, error: provisionError.message });
      skipped++;
      continue;
    }
    if (createdAuthThisRow) {
      createdUserIds.add(userId);
      imported++;
      tempPasswords.push({ email, password: generatedPassword! });
    } else {
      updated++;
    }
    touchedIds.push(userId);

    if (manager_email) managerLinks.push({ userId, email: manager_email, memberEmail: email, organizationId: profileOrganizationId, row: rowIndex + 2 });
  }

  for (const link of managerLinks) {
    const mgr = usersByEmail.get(link.email);
    if (mgr) {
      const { data: mgrProfile } = await ctx.sb
        .from('profiles')
        .select('organization_id, admin_scope')
        .eq('id', mgr.id)
        .single();
      if (!mgrProfile || mgrProfile.organization_id !== link.organizationId || mgrProfile.admin_scope !== 'none') {
        failures.push({ row: link.row, email: link.memberEmail, error: 'manager_must_be_in_same_organization' });
        continue;
      }
      const { error: managerError } = await ctx.sb.from('profiles').update({ manager_id: mgr.id }).eq('id', link.userId);
      if (managerError) failures.push({ row: link.row, email: link.memberEmail, error: managerError.message });
    } else {
      failures.push({ row: link.row, email: link.memberEmail, error: 'manager_not_found' });
    }
  }

  // Debounced matching (0025): flag imported users stale, then synchronously
  // process just those users so the admin sees fresh matches immediately.
  const warnings: string[] = [];
  if (touchedIds.length) {
    const { error: staleError } = await ctx.sb.from('profiles').update({ matches_stale: true }).in('id', touchedIds);
    if (staleError) warnings.push('match_queue_failed');
    else {
      const { error: matchError } = await ctx.sb.rpc('process_stale_matches', { p_batch: touchedIds.length });
      if (matchError) warnings.push('match_recompute_failed');
    }
  }
  const { count: matchCount, error: countError } = await ctx.sb.from('match_scores').select('*', { count: 'exact', head: true });
  if (countError) warnings.push('match_count_unavailable');

  const { error: auditError } = await ctx.sb.from('audit_logs').insert({
    actor_id: ctx.user.id,
    action: 'admin.upload',
    target_type: 'csv',
    metadata: { rows: rows.length, imported, updated, skipped, mode, organization_id: adminOrgId },
  });
  if (auditError) warnings.push('audit_log_failed');

  return jsonOk({
    imported, updated, skipped,
    total: rows.length,
    matchesGenerated: matchCount ?? 0,
    tempPasswords,
    failures,
    warnings,
  });
});
