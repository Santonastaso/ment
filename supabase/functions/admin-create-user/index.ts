// Admin: bulk-import employees from a CSV/XLSX file uploaded to the
// 'imports' Storage bucket. Replaces the legacy /api/admin/upload route.
//
// Body: { storage_path: string, mode: 'insert' | 'update' | 'upsert' }
// Returns: { imported, updated, skipped, total, tempPassword, matchesGenerated }

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireAdmin(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({}));
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

  const tempPassword = generateTempPassword();
  const adminOrgId = ctx.profile.organization_id;
  const isPlatformAdmin = ctx.profile.admin_scope === 'platform';
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const managerLinks: { userId: string; email: string; row: number }[] = [];
  const touchedIds: string[] = [];
  const failures: { row: number; email: string; error: string }[] = [];

  // The GoTrue admin API only paginates; it has no email filter despite older
  // callers passing one. Build the lookup once so updates work past page one.
  const authUsers: { id: string; email?: string }[] = [];
  for (let page = 1; page <= 100; page++) {
    const { data: usersPage, error: usersError } = await ctx.sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (usersError) return jsonError(`user_list_failed: ${usersError.message}`, 500);
    const users = usersPage?.users || [];
    authUsers.push(...users);
    if (users.length < 1000) break;
  }
  const usersByEmail = new Map(authUsers.map((u) => [(u.email || '').toLowerCase(), u]));

  for (const [rowIndex, raw] of rows.entries()) {
    const r = normRow(raw);
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

    let userId = usersByEmail.get(email)?.id;

    if (userId) {
      if (mode === 'insert') { skipped++; continue; }
      const { data: existingProfile } = await ctx.sb
        .from('profiles')
        .select('organization_id, admin_scope')
        .eq('id', userId)
        .single();
      if (!existingProfile || existingProfile.admin_scope !== 'none') { skipped++; continue; }
      if (!isPlatformAdmin && existingProfile.organization_id !== adminOrgId) { skipped++; continue; }
      const { error: profileError } = await ctx.sb.from('profiles').update({
        name, department, seniority, job_title, program, cohort_year, role: persona,
        tenure_years, location,
      }).eq('id', userId);
      if (profileError) {
        failures.push({ row: rowIndex + 2, email, error: profileError.message });
        skipped++;
        continue;
      }
      updated++;
      touchedIds.push(userId);
    } else {
      if (mode === 'update') { skipped++; continue; }
      const { data, error } = await ctx.sb.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          name, department, seniority, job_title, tenure_years, location,
          must_change_password: true, onboarding_complete: true, organization_id: adminOrgId,
        },
      });
      if (error || !data.user) {
        console.warn('createUser failed', email, error?.message);
        skipped++;
        failures.push({ row: rowIndex + 2, email, error: error?.message || 'user_create_failed' });
        continue;
      }
      userId = data.user.id;
      // Trigger seeded basic columns; upsert the rest in case metadata path differs.
      const { error: profileError } = await ctx.sb.from('profiles').update({
        name, department, seniority, job_title, program, cohort_year, role: persona,
        tenure_years, location,
        onboarding_complete: true,
        organization_id: adminOrgId,
      }).eq('id', userId);
      if (profileError) {
        failures.push({ row: rowIndex + 2, email, error: profileError.message });
        skipped++;
        continue;
      }
      imported++;
      touchedIds.push(userId);
      usersByEmail.set(email, { id: userId, email });
    }

    if (manager_email) managerLinks.push({ userId, email: manager_email, row: rowIndex + 2 });

    if (can_teach.length || wants_to_learn.length) {
      const { error: deleteSkillsError } = await ctx.sb.from('skills').delete().eq('user_id', userId);
      if (deleteSkillsError) {
        failures.push({ row: rowIndex + 2, email, error: deleteSkillsError.message });
        continue;
      }
      const skillRows = [
        ...can_teach.map((skill) => ({ user_id: userId!, skill, type: 'can_teach' })),
        ...wants_to_learn.map((skill) => ({ user_id: userId!, skill, type: 'wants_to_learn' })),
      ];
      if (skillRows.length) {
        const { error: insertSkillsError } = await ctx.sb.from('skills').insert(skillRows);
        if (insertSkillsError) {
          failures.push({ row: rowIndex + 2, email, error: insertSkillsError.message });
          continue;
        }
      }
    }
  }

  for (const link of managerLinks) {
    const mgr = usersByEmail.get(link.email);
    if (mgr) {
      const { data: mgrProfile } = await ctx.sb
        .from('profiles')
        .select('organization_id')
        .eq('id', mgr.id)
        .single();
      if (mgrProfile?.organization_id === adminOrgId || isPlatformAdmin) {
        const { error: managerError } = await ctx.sb.from('profiles').update({ manager_id: mgr.id }).eq('id', link.userId);
        if (managerError) failures.push({ row: link.row, email: link.email, error: managerError.message });
      }
    }
  }

  // Debounced matching (0025): flag imported users stale, then synchronously
  // process just those users so the admin sees fresh matches immediately.
  if (touchedIds.length) {
    const { error: staleError } = await ctx.sb.from('profiles').update({ matches_stale: true }).in('id', touchedIds);
    if (staleError) return jsonError(`match_queue_failed: ${staleError.message}`, 500);
    const { error: matchError } = await ctx.sb.rpc('process_stale_matches', { p_batch: touchedIds.length });
    if (matchError) return jsonError(`match_recompute_failed: ${matchError.message}`, 500);
  }
  const { count: matchCount, error: countError } = await ctx.sb.from('match_scores').select('*', { count: 'exact', head: true });
  if (countError) return jsonError(`match_count_failed: ${countError.message}`, 500);

  const { error: auditError } = await ctx.sb.from('audit_logs').insert({
    actor_id: ctx.user.id,
    action: 'admin.upload',
    target_type: 'csv',
    metadata: { rows: rows.length, imported, updated, skipped, mode, organization_id: adminOrgId },
  });
  if (auditError) return jsonError(`audit_log_failed: ${auditError.message}`, 500);

  return jsonOk({
    imported, updated, skipped,
    total: rows.length,
    matchesGenerated: matchCount ?? 0,
    tempPassword: imported > 0 ? tempPassword : null,
    failures,
  });
});
