#!/usr/bin/env node
// One-shot migration: server/ment.db -> Supabase. Safe to re-run on a clean
// project; not safe to run twice (it expects an empty target).
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Default to the legacy seed location; override with SQLITE_PATH env var.
const SQLITE_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_PATH)
  : path.resolve(__dirname, '..', 'ment.db');
const ID_MAP_PATH = path.resolve(__dirname, '..', 'migration-id-map.json');

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (source .env)');
  process.exit(1);
}
if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`Missing sqlite source: ${SQLITE_PATH}`);
  process.exit(1);
}

const supabase = createClient(URL, SERVICE, { auth: { persistSession: false } });
const sqlite = new Database(SQLITE_PATH, { readonly: true });

function tempPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function tsToIso(s) {
  if (!s) return null;
  // SQLite ms-less UTC strings -> ISO with Z
  if (s.includes('T')) return s;
  return s.replace(' ', 'T') + 'Z';
}

function safeJson(s, fallback) {
  if (s === null || s === undefined) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

const SHARED_TEMP_PASSWORD = tempPassword();

async function main() {
  console.log(`Migration source: ${SQLITE_PATH}`);
  console.log(`Migration target: ${URL}`);
  console.log(`Shared temp password (must rotate on first login): ${SHARED_TEMP_PASSWORD}\n`);

  // ---- Sanity: target must be empty ----
  const { count: profileCount, error: countErr } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  if (countErr) throw countErr;
  if (profileCount > 0) {
    console.error(`Target is not empty (${profileCount} profiles). Aborting.`);
    process.exit(1);
  }

  // ---- Users ----
  const sqliteUsers = sqlite.prepare(
    `select id, email, name, department, seniority, current_role, tenure_years, location, bio,
            shadow_role_response, pending_checkin, manager_id, must_change_password,
            deactivated_at, onboarding_complete, is_admin, created_at
     from users order by id`
  ).all();
  console.log(`Migrating ${sqliteUsers.length} users…`);

  const idMap = {};
  for (const u of sqliteUsers) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: SHARED_TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        name: u.name,
        department: u.department,
        seniority: u.seniority,
        job_title: u.current_role,
        tenure_years: u.tenure_years,
        location: u.location,
        bio: u.bio,
        is_admin: !!u.is_admin,
        must_change_password: true,
        onboarding_complete: !!u.onboarding_complete,
      },
    });
    if (error) {
      console.error(`createUser failed for ${u.email}:`, error.message);
      process.exit(1);
    }
    idMap[u.id] = data.user.id;

    const { error: updErr } = await supabase
      .from('profiles')
      .update({
        name: u.name || '',
        department: u.department || '',
        seniority: u.seniority || 'junior',
        job_title: u.current_role || '',
        tenure_years: u.tenure_years || 0,
        location: u.location || '',
        bio: u.bio || '',
        shadow_role_response: u.shadow_role_response || '',
        onboarding_complete: !!u.onboarding_complete,
      })
      .eq('id', data.user.id);
    if (updErr) {
      console.error(`profile update failed for ${u.email}:`, updErr.message);
      process.exit(1);
    }
    process.stdout.write(`  ${u.email} -> ${data.user.id}\n`);
  }

  // ---- Manager links (second pass) ----
  console.log('\nLinking managers…');
  for (const u of sqliteUsers) {
    if (u.manager_id && idMap[u.manager_id]) {
      const { error } = await supabase
        .from('profiles')
        .update({ manager_id: idMap[u.manager_id] })
        .eq('id', idMap[u.id]);
      if (error) console.warn(`manager_id link failed for ${u.email}:`, error.message);
    }
    if (u.deactivated_at) {
      const { error } = await supabase
        .from('profiles')
        .update({ deactivated_at: tsToIso(u.deactivated_at) })
        .eq('id', idMap[u.id]);
      if (error) console.warn(`deactivated_at write failed for ${u.email}:`, error.message);
    }
    if (u.pending_checkin) {
      const { error } = await supabase
        .from('profiles')
        .update({ pending_checkin: true })
        .eq('id', idMap[u.id]);
      if (error) console.warn(`pending_checkin write failed for ${u.email}:`, error.message);
    }
  }

  // ---- Skills ----
  const skills = sqlite.prepare('select * from skills').all();
  console.log(`\nMigrating ${skills.length} skills…`);
  if (skills.length) {
    const rows = skills.map(s => ({
      user_id: idMap[s.user_id],
      skill: s.skill,
      type: s.type,
      example_project: s.example_project || '',
    })).filter(r => r.user_id);
    const { error } = await supabase.from('skills').insert(rows);
    if (error) { console.error('skills insert failed:', error.message); process.exit(1); }
  }

  // ---- Career history ----
  const career = sqlite.prepare('select * from career_history').all();
  console.log(`Migrating ${career.length} career entries…`);
  if (career.length) {
    const rows = career.map(c => ({
      user_id: idMap[c.user_id],
      role_title: c.role,
      department: c.department,
      company: c.company || '',
      description: c.description || '',
      start_year: c.start_year,
      start_month: c.start_month,
      end_year: c.end_year,
      end_month: c.end_month,
    })).filter(r => r.user_id);
    const { error } = await supabase.from('career_history').insert(rows);
    if (error) { console.error('career insert failed:', error.message); process.exit(1); }
  }

  // ---- Connections (none in seed but handle anyway) ----
  const connections = sqlite.prepare('select * from connections').all();
  console.log(`Migrating ${connections.length} connections…`);
  for (const c of connections) {
    if (!idMap[c.requester_id] || !idMap[c.addressee_id]) continue;
    const { error } = await supabase.from('connections').insert({
      requester_id: idMap[c.requester_id],
      addressee_id: idMap[c.addressee_id],
      status: c.status || 'pending',
      created_at: tsToIso(c.created_at),
    });
    if (error) console.warn(`connection insert failed:`, error.message);
  }

  // ---- Sessions ----
  const sessions = sqlite.prepare('select * from sessions').all();
  console.log(`Migrating ${sessions.length} sessions…`);
  for (const s of sessions) {
    if (!idMap[s.mentor_id] || !idMap[s.mentee_id]) continue;
    const { error } = await supabase.from('sessions').insert({
      mentor_id: idMap[s.mentor_id],
      mentee_id: idMap[s.mentee_id],
      title: s.title,
      scheduled_at: tsToIso(s.scheduled_at),
      duration_minutes: s.duration_minutes || 60,
      status: s.status || 'pending',
      pre_session_question: s.pre_session_question || '',
      reflection: s.reflection || '',
      mentor_reflection: s.mentor_reflection || '',
      mentee_rating: s.mentee_rating,
      mentor_rating: s.mentor_rating,
      mentee_completed_at: tsToIso(s.mentee_completed_at),
      mentor_completed_at: tsToIso(s.mentor_completed_at),
      topics: safeJson(s.topics, []),
      created_at: tsToIso(s.created_at),
    });
    if (error) console.warn(`session insert failed:`, error.message);
  }

  // ---- Reflection logs ----
  const reflections = sqlite.prepare('select * from reflection_logs').all();
  console.log(`Migrating ${reflections.length} reflection logs…`);
  for (const r of reflections) {
    if (!idMap[r.user_id]) continue;
    const { error } = await supabase.from('reflection_logs').insert({
      user_id: idMap[r.user_id],
      support_needed: r.support_needed || '',
      managed_well: r.managed_well || '',
      extracted_gaps: safeJson(r.extracted_gaps, []),
      extracted_strengths: safeJson(r.extracted_strengths, []),
      esco_uris: safeJson(r.esco_uris, {}),
      classifier_source: r.classifier_source || '',
      applied: !!r.applied,
      created_at: tsToIso(r.created_at),
    });
    if (error) console.warn(`reflection insert failed:`, error.message);
  }

  // ---- Profile drafts ----
  const drafts = sqlite.prepare('select * from profile_drafts').all();
  console.log(`Migrating ${drafts.length} profile drafts…`);
  for (const d of drafts) {
    if (!idMap[d.user_id]) continue;
    const { error } = await supabase.from('profile_drafts').insert({
      user_id: idMap[d.user_id],
      source: d.source,
      raw_text: d.raw_text,
      proposed_json: safeJson(d.proposed_json, {}),
      accepted_json: safeJson(d.accepted_json, null),
      classifier_source: d.classifier_source,
      created_at: tsToIso(d.created_at),
      accepted_at: tsToIso(d.accepted_at),
    });
    if (error) console.warn(`draft insert failed:`, error.message);
  }

  // ---- Match scores (preserve a < b ordering) ----
  const matches = sqlite.prepare('select * from match_scores').all();
  console.log(`Migrating ${matches.length} match scores…`);
  for (const m of matches) {
    let aId = idMap[m.user_a_id];
    let bId = idMap[m.user_b_id];
    if (!aId || !bId) continue;
    if (aId > bId) [aId, bId] = [bId, aId];
    const reasons = safeJson(m.reasons, []).map(r => {
      // Remap any embedded user-int-ids to uuids
      const out = { ...r };
      if (typeof out.teacher_id === 'number') out.teacher_id = idMap[out.teacher_id];
      if (typeof out.learner_id === 'number') out.learner_id = idMap[out.learner_id];
      if (typeof out.who_id === 'number') out.who_id = idMap[out.who_id];
      if (typeof out.a_id === 'number') out.a_id = idMap[out.a_id];
      if (typeof out.b_id === 'number') out.b_id = idMap[out.b_id];
      return out;
    });
    const { error } = await supabase.from('match_scores').insert({
      user_a_id: aId,
      user_b_id: bId,
      score: m.score,
      reasons,
      computed_at: tsToIso(m.computed_at),
    });
    if (error) console.warn(`match insert failed:`, error.message);
  }

  // ---- Audit logs ----
  const audits = sqlite.prepare('select * from audit_logs').all();
  console.log(`Migrating ${audits.length} audit log entries…`);
  for (const a of audits) {
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: idMap[a.actor_id] || null,
      action: a.action,
      target_type: a.target_type || '',
      target_id: a.target_id != null ? String(a.target_id) : null,
      metadata: safeJson(a.metadata, {}),
      ip: a.ip || '',
      created_at: tsToIso(a.created_at),
    });
    if (error) console.warn(`audit insert failed:`, error.message);
  }

  fs.writeFileSync(ID_MAP_PATH, JSON.stringify(idMap, null, 2));
  console.log(`\nWrote ${ID_MAP_PATH}`);
  console.log(`\nDone. Distribute this temp password once: ${SHARED_TEMP_PASSWORD}`);
  console.log(`(Every migrated user must rotate it on first login.)`);
}

main().catch(e => { console.error(e); process.exit(1); });
