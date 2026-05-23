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
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const managerLinks: { userId: string; email: string }[] = [];

  for (const raw of rows) {
    const r = normRow(raw);
    const email = (r.email || '').toLowerCase();
    const name = r.name || r.full_name || '';
    if (!email || !name) { skipped++; continue; }

    const department = r.department || '';
    const job_title = r.current_role || r.role || r.job_title || '';
    const seniority = VALID_SENIORITIES.includes(r.seniority) ? r.seniority : 'junior';
    const tenure_years = parseInt(r.tenure_years || '0', 10) || 0;
    const location = r.location || '';
    const manager_email = (r.manager_email || r.manager || '').toLowerCase();
    const can_teach = parseSkillList(r.can_teach);
    const wants_to_learn = parseSkillList(r.wants_to_learn);

    const { data: existingUsers } = await ctx.sb.auth.admin.listUsers({ page: 1, perPage: 1, email });
    let userId = existingUsers?.users?.find((u) => u.email?.toLowerCase() === email)?.id;

    if (userId) {
      if (mode === 'insert') { skipped++; continue; }
      await ctx.sb.from('profiles').update({
        name, department, seniority, job_title, tenure_years, location,
      }).eq('id', userId);
      updated++;
    } else {
      if (mode === 'update') { skipped++; continue; }
      const { data, error } = await ctx.sb.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          name, department, seniority, job_title, tenure_years, location,
          must_change_password: true, onboarding_complete: true,
        },
      });
      if (error || !data.user) {
        console.warn('createUser failed', email, error?.message);
        skipped++;
        continue;
      }
      userId = data.user.id;
      // Trigger seeded basic columns; upsert the rest in case metadata path differs.
      await ctx.sb.from('profiles').update({
        name, department, seniority, job_title, tenure_years, location,
        onboarding_complete: true,
      }).eq('id', userId);
      imported++;
    }

    if (manager_email) managerLinks.push({ userId, email: manager_email });

    if (can_teach.length || wants_to_learn.length) {
      await ctx.sb.from('skills').delete().eq('user_id', userId);
      const skillRows = [
        ...can_teach.map((skill) => ({ user_id: userId!, skill, type: 'can_teach' })),
        ...wants_to_learn.map((skill) => ({ user_id: userId!, skill, type: 'wants_to_learn' })),
      ];
      if (skillRows.length) {
        await ctx.sb.from('skills').insert(skillRows);
      }
    }
  }

  for (const link of managerLinks) {
    const { data: page } = await ctx.sb.auth.admin.listUsers({ page: 1, perPage: 1, email: link.email });
    const mgr = page?.users?.find((u) => u.email?.toLowerCase() === link.email);
    if (mgr) {
      await ctx.sb.from('profiles').update({ manager_id: mgr.id }).eq('id', link.userId);
    }
  }

  await ctx.sb.rpc('recompute_all_matches');
  const { count: matchCount } = await ctx.sb.from('match_scores').select('*', { count: 'exact', head: true });

  await ctx.sb.from('audit_logs').insert({
    actor_id: ctx.user.id,
    action: 'admin.upload',
    target_type: 'csv',
    metadata: { rows: rows.length, imported, updated, skipped, mode },
  });

  return jsonOk({
    imported, updated, skipped,
    total: rows.length,
    matchesGenerated: matchCount ?? 0,
    tempPassword: imported > 0 ? tempPassword : null,
  });
});
