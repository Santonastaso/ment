// Backwards-compatible API shim. Routes legacy `api.get/post/put/delete(...)`
// calls to Supabase: direct PostgREST queries, RPCs, or Edge Functions.
//
// This is a translation layer kept tight on purpose. New code should call
// `supabase` directly from `client/src/lib/supabase.js`.

import { supabase } from '../lib/supabase.js';
import { browserLanguage } from '../lib/esco.js';
import { firstPersonize } from '../lib/utils.js';
import { translate } from '../i18n/index.jsx';

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.response = { status, data: { error: message } };
  }
}

function ok(data, status = 200) {
  return { data, status };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function getViewerId() {
  const { data } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) throw new ApiError('auth_required', 401);
  return id;
}

async function getViewer() {
  const id = await getViewerId();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, department, seniority, job_title, is_admin, admin_scope, organization_id')
    .eq('id', id)
    .single();
  if (error) throw new ApiError(error.message);
  return data;
}

// ============================================================
// Legacy field shaping
// ============================================================

function shapeProfile(row, viewerId) {
  if (!row) return null;
  const isSelf = row.id === viewerId;
  return {
    ...row,
    current_role: row.job_title, // legacy alias
    direct_reports: row.direct_reports ?? 0,
    must_change_password: isSelf ? row.must_change_password : undefined,
    deactivated_at: isSelf ? row.deactivated_at : row.deactivated_at,
  };
}

function shapeCareer(rows) {
  // Sort reverse-chronologically by (start_year, start_month) so the latest
  // role is always first regardless of insertion order. Null months treated
  // as 0 so they fall behind dated entries within the same year. Null years
  // get pushed to the bottom of the list.
  const list = (rows || []).map((c) => ({ ...c, role: c.role_title }));
  list.sort((a, b) => {
    const ay = a.start_year ?? -Infinity;
    const by = b.start_year ?? -Infinity;
    if (by !== ay) return by - ay;
    const am = a.start_month ?? 0;
    const bm = b.start_month ?? 0;
    if (bm !== am) return bm - am;
    // Tie-break by end_year descending so an ongoing role wins over a
    // completed one with the same start.
    const aey = a.end_year ?? Infinity;
    const bey = b.end_year ?? Infinity;
    return bey - aey;
  });
  return list;
}

function shapeUser(u) {
  if (!u) return null;
  return { ...u, current_role: u.job_title ?? u.current_role };
}

// ============================================================
// Match-reason rendering (port of server/utils/matching.js renderReasons)
// ============================================================

function renderReasons(structured, viewer, other, opts = {}) {
  if (!Array.isArray(structured)) return [];
  const mentorOnly = opts.mentorOnly === true;
  const them = (other.name || '').split(' ')[0] || other.name || 'They';
  const out = [];
  for (const r of structured) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'teach_overlap') {
      const skills = (r.skills || []).slice(0, 3).join(', ');
      if (r.teacher_id === other.id) {
        out.push(translate('components.matchReason.teachOverlapThem', { them, skills }));
      } else if (r.teacher_id === viewer.id) {
        if (mentorOnly) continue;
        out.push(translate('components.matchReason.teachOverlapYou', { them, skills }));
      }
    } else if (r.type === 'career_bridge') {
      if (r.who_id === other.id) {
        out.push(translate('components.matchReason.careerBridgeThem', { them, dept: r.into_dept }));
      } else if (r.who_id === viewer.id) {
        if (mentorOnly) continue;
        out.push(translate('components.matchReason.careerBridgeYou', { them, dept: other.department }));
      }
    } else if (r.type === 'dept_diversity') {
      const otherDept = r.a_id === other.id ? r.a_dept : r.b_dept;
      const yourDept = r.a_id === viewer.id ? r.a_dept : r.b_dept;
      out.push(translate('components.matchReason.deptDiversity', { them, otherDept, yourDept }));
    }
  }
  return out;
}

// Server-side "extra reasons" arrive as structured tokens { type, dept } (0020)
// so they can be localized client-side. Tolerate legacy plain strings too.
function renderExtraReason(x) {
  if (typeof x === 'string') return x;
  if (!x || typeof x !== 'object' || !x.type) return null;
  return translate(`components.matchReason.${x.type}`, { dept: x.dept });
}

// ============================================================
// Reflection classification with retry + refetch
// ============================================================

// Classify a reflection_logs row. Invokes the edge function up to
// `invocations` times with backoff, then refetches the row and returns it.
// Always resolves (never throws): if every invocation fails we still refetch
// so callers see the row in its current state and can surface a re-classify
// affordance.
//
// `budgetMs` caps the total wall-clock spent blocking the caller. The retry
// loop exits early once the budget is consumed; the caller can decide
// whether to surface success or schedule another async retry.
async function classifyReflectionWithRetry(reflectionLogId, opts = {}) {
  const invocations = Math.max(1, opts.invocations ?? 3);
  const budgetMs = Math.max(0, opts.budgetMs ?? 12000);
  const backoff = [200, 600, 1500];
  const start = Date.now();

  const lang = browserLanguage();
  for (let i = 0; i < invocations; i++) {
    try {
      await supabase.functions.invoke('reflection-classify', {
        body: { reflection_log_id: reflectionLogId, lang },
      });
    } catch {
      // invoke errors fall through to the refetch — the edge function may
      // still have written the row (or another tab kicked the classifier).
    }

    // After the call (success or failure), read the row back. If
    // classifier_source is populated we are done.
    const { data: row } = await supabase
      .from('reflection_logs')
      .select('*')
      .eq('id', reflectionLogId)
      .maybeSingle();

    if (!row) return null; // row deleted while we were retrying
    const cs = (row.classifier_source || '').trim().toLowerCase();
    // 'unclassified' is the explicit "edge function ran but nothing matched"
    // sentinel — keep retrying, ESCO might come back with hits next round.
    if (cs && cs !== 'unclassified') return row;

    if (i >= invocations - 1) return row;
    if (Date.now() - start >= budgetMs) return row;

    await new Promise((r) => setTimeout(r, backoff[Math.min(i, backoff.length - 1)]));
  }
  return null;
}

// ============================================================
// Profile composition for /users/me and /users/:id
// ============================================================

async function fetchAuthEmail(userId) {
  // We can't read auth.users directly from the client; cache email via supabase.auth.user() if it's the viewer.
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user?.id === userId) return data.session.user.email || '';
  return '';
}

async function loadProfile(userId, viewerId) {
  const isSelf = userId === viewerId;
  if (!isSelf) {
    const { data, error } = await supabase.rpc('peer_profile', { p_user_id: userId });
    if (error) throw new ApiError(error.message, 404);
    if (!data) throw new ApiError('User not found', 404);
    return data;
  }

  // After 0012 we no longer have direct SELECT on the full profiles row from
  // an authenticated session. Owner reads go through my_profile() (security
  // definer) so the sensitive columns (shadow_role_response) come through.
  const { data: row, error } = await supabase.rpc('my_profile');
  if (error) throw new ApiError(error.message);
  if (!row) throw new ApiError('User not found', 404);

  const [skillsRes, careerRes, progressRes, badgesRes, expertiseRes, reportsCountRes] = await Promise.all([
    supabase.from('skills').select('id, user_id, skill, type, example_project').eq('user_id', userId),
    supabase.from('career_history').select('*').eq('user_id', userId).order('start_year', { ascending: false }),
    supabase.rpc('skill_progress_for', { p_user_id: userId }),
    supabase.rpc('badges_for', { p_user_id: userId }),
    supabase.rpc('expertise_signature_for', { p_user_id: userId }),
    supabase.rpc('direct_report_count', { p_manager_id: userId }),
  ]);

  const allSkills = (skillsRes.data || []).map((s) => ({ ...s }));
  const skills = isSelf ? allSkills : allSkills.filter((s) => s.type !== 'wants_to_learn');
  const allProgress = progressRes.data || [];
  const skillProgress = isSelf ? allProgress : allProgress.filter((s) => s.type !== 'wants_to_learn');

  const career = shapeCareer(careerRes.data);
  const badges = badgesRes.data || [];
  const expertiseSignature = (expertiseRes.data || []).map((r) => r.skill);
  const direct_reports = reportsCountRes.data ?? 0;

  const email = await fetchAuthEmail(userId);

  const payload = shapeProfile(
    {
      ...row,
      email,
      skills,
      career,
      badges,
      skillProgress,
      expertiseSignature,
      direct_reports,
    },
    viewerId
  );

  if (!isSelf) {
    delete payload.shadow_role_response;
    delete payload.must_change_password;
  }
  if (!isSelf && row.deactivated_at) {
    payload.name = '[Former colleague]';
  }
  return payload;
}

// ============================================================
// Sessions
// ============================================================

async function fetchSessionUser(userId, viewerId) {
  if (userId !== viewerId) {
    const { data } = await supabase.rpc('peer_profile', { p_user_id: userId });
    return data ? shapeUser(data) : null;
  }
  const { data } = await supabase
    .from('profiles')
    .select('id, name, department, seniority, job_title, deactivated_at')
    .eq('id', userId)
    .single();
  if (!data) return null;
  // attach email when this user is the viewer (otherwise not exposed)
  return shapeUser(data);
}

async function enrichSession(session, viewerId) {
  const isMentor = session.mentor_id === viewerId;
  const isMentee = session.mentee_id === viewerId;
  const [mentor, mentee] = await Promise.all([
    fetchSessionUser(session.mentor_id, viewerId),
    fetchSessionUser(session.mentee_id, viewerId),
  ]);
  if (mentor?.deactivated_at) mentor.name = '[Former colleague]';
  if (mentee?.deactivated_at) mentee.name = '[Former colleague]';

  // legacy: viewer's own email visible on mentor/mentee for ICS
  if (mentor?.id === viewerId || mentee?.id === viewerId) {
    const { data } = await supabase.auth.getSession();
    const myEmail = data?.session?.user?.email || '';
    if (mentor?.id === viewerId) mentor.email = myEmail;
    if (mentee?.id === viewerId) mentee.email = myEmail;
  }

  let topics = [];
  if (Array.isArray(session.topics)) topics = session.topics;
  else if (session.topics) {
    try {
      const parsed = JSON.parse(session.topics);
      if (Array.isArray(parsed)) topics = parsed;
    } catch { /* noop */ }
  }

  const scheduled = session.scheduled_at ? new Date(session.scheduled_at) : null;
  const myCompleted = isMentor ? session.mentor_completed_at : session.mentee_completed_at;
  const needs_my_completion = !!((isMentor || isMentee) && scheduled && scheduled < new Date() && !myCompleted);
  // True once the viewer has submitted their own reflection/completion, even
  // if the counterpart hasn't yet (so status is still 'scheduled'). Used to
  // move the session out of the viewer's active lists into Past meetings.
  const viewer_completed = !!((isMentor || isMentee) && myCompleted);

  return {
    ...session,
    mentor,
    mentee,
    isMentor,
    isMentee,
    topics,
    needs_my_completion,
    viewer_completed,
    reflection: isMentee ? session.reflection : undefined,
    mentor_reflection: isMentor ? session.mentor_reflection : undefined,
    mentee_rating: isMentee ? session.mentee_rating : undefined,
    mentor_rating: isMentor ? session.mentor_rating : undefined,
    pre_session_question: isMentor ? session.pre_session_question : undefined,
  };
}

// ============================================================
// Match list (calls get_matches_for, renders reasons in JS)
// ============================================================

async function listMatches({ limit, role, includeDirectory = false } = {}) {
  const viewer = await getViewer();
  const rpcArgs = {
    p_role: role ?? null,
    p_limit: null, // we paginate after rendering reasons
    p_offset: 0,
  };
  if (includeDirectory) rpcArgs.p_include_directory = true;
  let { data, error } = await supabase.rpc('get_matches_for', rpcArgs);
  if (error && includeDirectory && /get_matches_for|function/i.test(error.message || '')) {
    ({ data, error } = await supabase.rpc('get_matches_for', {
      p_role: role ?? null,
      p_limit: null,
      p_offset: 0,
    }));
  }
  if (error) throw new ApiError(error.message);

  const all = (data?.matches || []).map((m) => {
    const candidate = m.user;
    const renderedBase = renderReasons(m.structuredReasons, { id: viewer.id, name: viewer.name, department: viewer.department }, {
      id: candidate.id, name: candidate.name, department: candidate.department,
    }, { mentorOnly: role === 'mentor' });
    const reasons = [...renderedBase, ...(m.extraReasons || []).map(renderExtraReason).filter(Boolean)];
    return {
      matchId: m.matchId,
      score: m.score,
      baseScore: m.baseScore,
      adjustment: m.adjustment,
      reasons,
      user: shapeUser(candidate),
    };
  });

  const sliced = limit ? all.slice(0, Number(limit)) : all;
  return { matches: sliced, total: data?.total ?? all.length };
}

// ============================================================
// Storage helpers (file uploads)
// ============================================================

async function uploadToStorage(bucket, prefix, file) {
  const filename = `${Date.now()}-${(file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const path = prefix ? `${prefix}/${filename}` : filename;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new ApiError(error.message);
  return path;
}

// ============================================================
// Router: api.get/post/put/delete(url, body, options)
// ============================================================

async function get(url) {
  const viewer = await getViewer();

  if (url === '/users/me') {
    return ok(await loadProfile(viewer.id, viewer.id));
  }
  if (url === '/users/me/monthly-count') {
    const { data, error } = await supabase.rpc('my_monthly_completed_count');
    if (error) throw new ApiError(error.message);
    return ok({ completed: data ?? 0 });
  }
  if (url === '/users/me/unavailable-periods') {
    const { data, error } = await supabase
      .from('mentorship_unavailable_periods')
      .select('id, start_date, end_date, note')
      .eq('user_id', viewer.id)
      .order('start_date', { ascending: true });
    if (error) throw new ApiError(error.message);
    return ok(data || []);
  }
  if (url.startsWith('/users/')) {
    const id = url.slice('/users/'.length);
    return ok(await loadProfile(id, viewer.id));
  }

  if (url.startsWith('/matches')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    return ok(await listMatches({
      limit: params.get('limit'),
      role: params.get('role'),
      includeDirectory: params.get('includeDirectory') === '1',
    }));
  }

  if (url === '/sessions') {
    const { data, error } = await supabase.rpc('my_sessions');
    if (error) throw new ApiError(error.message);
    const enriched = await Promise.all((data || []).map((s) => enrichSession(s, viewer.id)));
    return ok(enriched);
  }
  if (url === '/sessions/pending-acceptances') {
    const { data, error } = await supabase.rpc('pending_acceptances');
    if (error) throw new ApiError(error.message);
    const enriched = await Promise.all((data || []).map((s) => enrichSession(s, viewer.id)));
    return ok(enriched);
  }
  if (url.startsWith('/sessions/') && !url.endsWith('/ics')) {
    const id = Number(url.slice('/sessions/'.length));
    const { data, error } = await supabase.rpc('my_session', { p_session_id: id });
    if (error) throw new ApiError(error.message, 404);
    return ok(await enrichSession(data, viewer.id));
  }

  if (url === '/reflections') {
    const { data: rows, error } = await supabase
      .from('reflection_logs')
      .select('*')
      .eq('user_id', viewer.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new ApiError(error.message);

    const last = rows?.[0];
    const lastDays = last
      ? Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86_400_000)
      : null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('pending_checkin')
      .eq('id', viewer.id)
      .single();
    const pendingFromAdmin = !!profile?.pending_checkin;
    const dueFromTime = lastDays === null || lastDays >= 4;

    return ok({
      entries: (rows || []).map((r) => ({
        id: r.id,
        support_needed: r.support_needed,
        managed_well: r.managed_well,
        extracted_gaps: Array.isArray(r.extracted_gaps) ? r.extracted_gaps : [],
        extracted_strengths: Array.isArray(r.extracted_strengths) ? r.extracted_strengths : [],
        esco_uris: r.esco_uris || {},
        classifier_source: r.classifier_source,
        applied: !!r.applied,
        created_at: r.created_at,
      })),
      dueForCheckIn: pendingFromAdmin || dueFromTime,
      pendingFromAdmin,
      lastEntryDays: lastDays,
    });
  }

  if (url === '/team/skill-gaps') {
    const { data, error } = await supabase.rpc('team_skill_gaps', { p_manager_id: viewer.id });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (url === '/admin/stats') {
    const { data, error } = await supabase.rpc('admin_stats');
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/kpis' || url.startsWith('/admin/kpis?')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const org = params.get('org');
    const { data, error } = await supabase.rpc('admin_kpis', { p_org: org || null });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/most-active-users' || url.startsWith('/admin/most-active-users?')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const limit = Number(params.get('limit') || 10);
    const { data, error } = await supabase.rpc('most_active_users', { p_limit: limit });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/owner-stats') {
    const { data, error } = await supabase.rpc('platform_owner_stats');
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/privacy-status') {
    const { data, error } = await supabase.rpc('privacy_status');
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/knowledge-graph' || url.startsWith('/admin/knowledge-graph?')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const org = params.get('org');
    const language = params.get('language');
    const { data, error } = await supabase.rpc('knowledge_graph', {
      p_org: org || null,
      p_language: language || null,
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/access-requests' || url.startsWith('/admin/access-requests?')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const limit = Number(params.get('limit') || 100);
    const { data, error } = await supabase.rpc('platform_access_requests', { p_limit: limit });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/feedback' || url.startsWith('/admin/feedback?')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const status = params.get('status') || null;
    const { data, error } = await supabase.rpc('list_feedback', { p_status: status });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url.startsWith('/admin/users')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const limit = Number(params.get('limit') || 100);
    const offset = Number(params.get('offset') || 0);
    const { data, error } = await supabase.rpc('admin_users', { p_limit: limit, p_offset: offset });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/audit' || url.startsWith('/admin/audit?')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const limit = Number(params.get('limit') || 100);
    const { data, error } = await supabase.rpc('admin_audit', { p_limit: limit });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url === '/admin/audit/export') {
    const { data, error } = await supabase.rpc('admin_audit', { p_limit: 10000 });
    if (error) throw new ApiError(error.message);
    const csvEscape = (v) => {
      const s = String(v ?? '');
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'id,created_at,actor_email,action,target_type,target_id,ip,metadata_json\n';
    const body = (data?.entries || []).map((r) => [
      r.id, r.created_at, r.actor?.email ?? '', r.action,
      r.target_type, r.target_id ?? '', r.ip ?? '', JSON.stringify(r.metadata || {}),
    ].map(csvEscape).join(',')).join('\n');
    return ok(new Blob([header + body], { type: 'text/csv' }));
  }
  if (url === '/admin/template') {
    const csv =
      'name,email,department,current_role,tenure_years,location,manager_email,can_teach,wants_to_learn\n' +
      'Jane Smith,jane.smith@company.com,Engineering,Software Engineer,3,London,sarah.lead@company.com,"React,TypeScript","system design,leadership"\n' +
      'John Doe,john.doe@company.com,Finance,Financial Analyst,1,New York,frank.wu@company.com,"Excel","financial modeling,Python"\n';
    return ok(new Blob([csv], { type: 'text/csv' }));
  }

  throw new ApiError(`Unhandled GET ${url}`, 404);
}

async function post(url, body = {}, opts = {}) {
  if (url === '/access-requests') {
    const honeypot = (body.website || body.url || body.company_website || body.honeypot || '').toString().trim();
    if (honeypot) throw new ApiError('invalid_submission', 400);

    const name = (body.name || '').toString().trim();
    const email = (body.email || body.work_email || '').toString().trim().toLowerCase();
    const company = (body.company || '').toString().trim();
    const companySize = (body.company_size || body.companySize || '').toString().trim();
    const role = (body.role || '').toString().trim();
    const note = (body.note || '').toString().trim();

    if (!name || !email || !company || !companySize || !role) {
      throw new ApiError('required_fields_missing', 400);
    }
    if (!EMAIL_RE.test(email)) throw new ApiError('invalid_email', 400);
    if (note.length > 2000) throw new ApiError('note_too_long', 400);

    const { error } = await supabase.from('access_requests').insert({
      name,
      email,
      company,
      company_size: companySize,
      role,
      note,
    });
    if (error?.code === '23505') throw new ApiError('request_already_open', 409);
    if (error) throw new ApiError(error.message, 400);
    return ok({ ok: true }, 201);
  }

  const viewer = await getViewer();

  if (url === '/users/me/skills') {
    const { skill, type, example_project } = body;
    const example = type === 'can_teach' ? (example_project || '').toString().trim() : '';
    const { data, error } = await supabase
      .from('skills')
      .insert({ user_id: viewer.id, skill: skill.trim(), type, example_project: example })
      .select()
      .single();
    if (error) throw new ApiError(error.message);
    await supabase.rpc('recompute_matches_for', { p_user_id: viewer.id });
    return ok(data, 201);
  }

  if (url === '/users/me/unavailable-periods') {
    if (!body.start_date || !body.end_date) throw new ApiError('start_date and end_date are required', 400);
    if (body.end_date < body.start_date) throw new ApiError('end_date must be on or after start_date', 400);
    const { data, error } = await supabase
      .from('mentorship_unavailable_periods')
      .insert({
        user_id: viewer.id,
        start_date: body.start_date,
        end_date: body.end_date,
        note: (body.note || '').toString().trim() || null,
      })
      .select('id, start_date, end_date, note')
      .single();
    if (error) throw new ApiError(error.message);
    return ok(data, 201);
  }

  if (url === '/users/me/career') {
    const payload = {
      user_id: viewer.id,
      role_title: body.role,
      department: body.department,
      company: body.company || '',
      description: firstPersonize(body.description || ''),
      start_year: body.start_year ?? null,
      start_month: body.start_month ?? null,
      end_year: body.end_year ?? null,
      end_month: body.end_month ?? null,
    };
    const { data, error } = await supabase.from('career_history').insert(payload).select().single();
    if (error) throw new ApiError(error.message);
    await supabase.rpc('recompute_matches_for', { p_user_id: viewer.id });
    return ok({ ...data, role: data.role_title }, 201);
  }

  if (url === '/users/me/onboarding') {
    const { error } = await supabase.rpc('save_onboarding', {
      p_name: body.name,
      p_department: body.department,
      p_seniority: body.seniority,
      p_job_title: body.current_role || body.job_title || '',
      p_bio: body.bio || '',
      p_shadow_role_response: body.shadow_role_response || '',
      p_tenure_years: parseInt(body.tenure_years || 0, 10),
      p_location: body.location || '',
      p_career: (body.career || []).map((c) => ({
        role_title: c.role,
        department: c.department,
        company: c.company || '',
        description: firstPersonize(c.description || ''),
        start_year: c.start_year ?? null,
        start_month: c.start_month ?? null,
        end_year: c.end_year ?? null,
        end_month: c.end_month ?? null,
      })),
      p_can_teach: (body.can_teach || []).map((s) => (typeof s === 'string' ? s : s.skill)),
      p_wants_to_learn: body.wants_to_learn || [],
    });
    if (error) throw new ApiError(error.message);
    return ok(await loadProfile(viewer.id, viewer.id));
  }

  if (url === '/sessions') {
    const { data, error } = await supabase.rpc('request_session', {
      p_mentor_id: body.mentor_id,
      p_title: body.title,
      p_scheduled_at: body.scheduled_at || null,
      p_duration_minutes: body.duration_minutes || 60,
      p_pre_session_question: body.pre_session_question || '',
      p_topics: body.topics ?? null,
    });
    if (error) throw new ApiError(error.message);
    return ok(await enrichSession(data, viewer.id), 201);
  }

  if (/^\/sessions\/\d+\/acknowledge$/.test(url)) {
    const id = Number(url.split('/')[2]);
    const { error } = await supabase.rpc('acknowledge_session', { p_session_id: id });
    if (error) throw new ApiError(error.message);
    return ok({ id, acknowledged: true });
  }

  if (url === '/connections') {
    const { data, error } = await supabase.rpc('upsert_connection', {
      p_addressee_id: body.addressee_id,
      p_status: body.status || 'pending',
    });
    if (error) throw new ApiError(error.message);
    return ok(data, 201);
  }

  if (url === '/feedback') {
    const { data, error } = await supabase.rpc('submit_feedback', {
      p_category: body.category || 'general',
      p_message: body.message || '',
    });
    if (error) throw new ApiError(error.message);
    return ok(data, 201);
  }

  if (url === '/reflections') {
    const { data: row, error } = await supabase
      .from('reflection_logs')
      .insert({
        user_id: viewer.id,
        support_needed: (body.support_needed || '').trim(),
        managed_well: (body.managed_well || '').trim(),
      })
      .select()
      .single();
    if (error) throw new ApiError(error.message);
    // Acknowledge the admin nudge
    await supabase.rpc('acknowledge_checkin');
    // Block on classification but cap the wait so the Save button never
    // hangs for tens of seconds when the edge function is slow. The
    // dashboard reloads on submit and the Re-run classification button
    // covers the case where the row comes back unclassified.
    const classified = await classifyReflectionWithRetry(row.id, { invocations: 2, budgetMs: 5000 });
    return ok({ ...(classified || row), applied: false }, 201);
  }

  if (/^\/reflections\/\d+\/reclassify$/.test(url)) {
    const id = Number(url.split('/')[2]);
    const result = await classifyReflectionWithRetry(id, { invocations: 3, budgetMs: 15000 });
    if (!result) throw new ApiError('reclassify_failed', 502);
    const cs = (result.classifier_source || '').trim().toLowerCase();
    if (!cs || cs === 'unclassified') {
      // We refetched the row but the classifier still couldn't tag it.
      // Surface a 502 rather than a false-success so the UI keeps prompting
      // the user to retry.
      const err = new ApiError('reclassify_unclassified', 502);
      err.payload = result;
      throw err;
    }
    return ok(result);
  }

  if (/^\/reflections\/\d+\/apply$/.test(url)) {
    const id = Number(url.split('/')[2]);
    const { data, error } = await supabase.rpc('apply_reflection', {
      p_reflection_id: id,
      p_gaps: body.gaps ?? null,
      p_strengths: body.strengths ?? null,
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (url === '/profile/ingest') {
    if (!(body instanceof FormData)) throw new ApiError('expected_form_data', 400);
    const file = body.get('file');
    const kind = body.get('kind') || 'performance_review';
    if (!file) throw new ApiError('no_file', 400);
    const path = await uploadToStorage('profile-uploads', viewer.id, file);
    const { data, error } = await supabase.functions.invoke('profile-ingest', {
      body: { storage_path: path, kind, lang: browserLanguage() },
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (/^\/profile\/ingest\/\d+\/accept$/.test(url)) {
    const id = Number(url.split('/')[3]);
    const { error } = await supabase
      .from('profile_drafts')
      .update({ accepted_json: body.accepted_json || body.accepted, accepted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', viewer.id);
    if (error) throw new ApiError(error.message);
    return ok({ ok: true });
  }

  if (url.startsWith('/admin/upload')) {
    if (!(body instanceof FormData)) throw new ApiError('expected_form_data', 400);
    const file = body.get('file');
    const params = new URLSearchParams(url.split('?')[1] || '');
    const mode = params.get('mode') || 'insert';
    if (!file) throw new ApiError('no_file', 400);
    const path = await uploadToStorage('imports', `${viewer.id}/imports`, file);
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { storage_path: path, mode },
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (url === '/admin/rematch') {
    const { data, error } = await supabase.rpc('admin_recompute_matches');
    if (error) throw new ApiError(error.message);
    return ok({ matchesGenerated: data ?? 0, message: `Matching complete. ${data ?? 0} match pairs stored.` });
  }

  if (url === '/admin/broadcast-checkin') {
    const { data, error } = await supabase.rpc('admin_broadcast_checkin');
    if (error) throw new ApiError(error.message);
    return ok({
      recipients: data,
      sentAt: new Date().toISOString(),
      message: `Check-in nudge queued for ${data} employees.`,
    });
  }

  if (url === '/admin/organizations') {
    const name = (body.name || '').toString().trim();
    const type = body.type === 'inter' ? 'inter' : 'intra';
    const { data, error } = await supabase.rpc('platform_create_organization', { p_name: name, p_type: type });
    if (error) throw new ApiError(error.message);
    return ok(data, 201);
  }

  if (/^\/admin\/users\/[^/]+\/reset-password$/.test(url)) {
    const id = url.split('/')[3];
    const { data, error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: id } });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  throw new ApiError(`Unhandled POST ${url}`, 404);
}

async function put(url, body = {}) {
  const viewer = await getViewer();

  if (url === '/users/me') {
    const allowed = [
      'name', 'department', 'seniority', 'bio', 'shadow_role_response',
      'tenure_years', 'location',
      // Personal availability — drives whether the user shows up as a
      // mentor candidate.
      'mentorship_paused', 'mentorship_unavailable_until', 'mentorship_note',
      // Optional monthly goal — feeds the soft nudge on the dashboard.
      'monthly_session_goal',
    ];
    const update = {};
    for (const k of allowed) if (Object.prototype.hasOwnProperty.call(body, k)) update[k] = body[k];
    if (Object.prototype.hasOwnProperty.call(body, 'current_role')) update.job_title = body.current_role;
    const { error } = await supabase.from('profiles').update(update).eq('id', viewer.id);
    if (error) throw new ApiError(error.message);
    return ok(await loadProfile(viewer.id, viewer.id));
  }

  if (/^\/users\/me\/skills\/\d+$/.test(url)) {
    const id = Number(url.split('/')[4]);
    const { data, error } = await supabase
      .from('skills')
      .update({ example_project: body.example_project || '' })
      .eq('id', id)
      .eq('user_id', viewer.id)
      .select()
      .single();
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (/^\/users\/me\/career\/\d+$/.test(url)) {
    const id = Number(url.split('/')[4]);
    const update = {};
    if (Object.prototype.hasOwnProperty.call(body, 'role')) update.role_title = body.role;
    for (const k of ['department','company','description','start_year','start_month','end_year','end_month']) {
      if (Object.prototype.hasOwnProperty.call(body, k)) update[k] = body[k];
    }
    if (Object.prototype.hasOwnProperty.call(update, 'description')) {
      update.description = firstPersonize(update.description || '');
    }
    const { data, error } = await supabase
      .from('career_history')
      .update(update)
      .eq('id', id)
      .eq('user_id', viewer.id)
      .select()
      .single();
    if (error) throw new ApiError(error.message);
    await supabase.rpc('recompute_matches_for', { p_user_id: viewer.id });
    return ok({ ...data, role: data.role_title });
  }

  if (/^\/sessions\/\d+$/.test(url)) {
    const id = Number(url.split('/')[2]);
    let session;
    if (body.status === 'scheduled') {
      const { data, error } = await supabase.rpc('accept_session', {
        p_session_id: id, p_scheduled_at: body.scheduled_at || null,
      });
      if (error) throw new ApiError(error.message);
      session = data;
    } else if (body.status === 'completed') {
      // Per-role completion: send the matching reflection/rating to the RPC
      const role = (await supabase.rpc('my_session', { p_session_id: id })).data;
      const isMentor = role?.mentor_id === viewer.id;
      const refl = isMentor ? body.mentor_reflection : body.reflection;
      const rating = isMentor ? body.mentor_rating : body.mentee_rating;
      const { data, error } = await supabase.rpc('complete_session', {
        p_session_id: id,
        p_reflection: refl ?? null,
        p_rating: rating ?? null,
      });
      if (error) throw new ApiError(error.message);
      session = data;
    } else if (body.status === 'cancelled' || body.status === 'declined') {
      const { data, error } = await supabase.rpc('cancel_session', {
        p_session_id: id, p_status: body.status,
      });
      if (error) throw new ApiError(error.message);
      session = data;
    } else if (body.scheduled_at !== undefined) {
      const { data, error } = await supabase.rpc('reschedule_session', {
        p_session_id: id, p_scheduled_at: body.scheduled_at,
      });
      if (error) throw new ApiError(error.message);
      session = data;
    } else {
      // Field-only update (reflection text, rating after-the-fact) — routed
      // through a security-definer RPC that enforces participant-only,
      // role-scoped writes. The RPC figures out the caller's role, so we
      // collapse the mentor/mentee variants into a single reflection +
      // rating pair.
      const refl = Object.prototype.hasOwnProperty.call(body, 'mentor_reflection')
        ? body.mentor_reflection
        : (Object.prototype.hasOwnProperty.call(body, 'reflection') ? body.reflection : null);
      const rating = Object.prototype.hasOwnProperty.call(body, 'mentor_rating')
        ? body.mentor_rating
        : (Object.prototype.hasOwnProperty.call(body, 'mentee_rating') ? body.mentee_rating : null);
      const { data, error } = await supabase.rpc('update_session_feedback', {
        p_session_id: id,
        p_reflection: refl ?? null,
        p_rating: rating ?? null,
      });
      if (error) throw new ApiError(error.message);
      session = data;
    }
    return ok(await enrichSession(session, viewer.id));
  }

  if (/^\/admin\/access-requests\/\d+$/.test(url)) {
    const id = Number(url.split('/')[3]);
    const { data, error } = await supabase.rpc('platform_update_access_request', {
      p_id: id,
      p_status: body.status,
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (url === '/admin/org-privacy') {
    const payload = {
      p_type: body.type ?? null,
      p_min_team_dashboard_size: body.min_team_dashboard_size ?? null,
    };
    const { data, error } = await supabase.rpc('set_org_privacy', payload);
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  // Org-scoped admin asks platform owners to flip intra<->inter.
  // The platform admins see the resulting request in the existing feedback
  // queue and act on it via set_org_privacy.
  if (url === '/admin/org-privacy/request') {
    const { data, error } = await supabase.rpc('request_org_tier_change', {
      p_requested_type: body.type,
      p_note: body.note ?? '',
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (/^\/admin\/feedback\/\d+$/.test(url)) {
    const id = Number(url.split('/')[3]);
    const { data, error } = await supabase.rpc('update_feedback_status', {
      p_id: id,
      p_status: body.status,
    });
    if (error) throw new ApiError(error.message);
    return ok(data);
  }

  if (/^\/admin\/users\/[^/]+$/.test(url)) {
    const id = url.split('/')[3];
    if (Object.prototype.hasOwnProperty.call(body, 'manager_email')) {
      const { error } = await supabase.rpc('admin_set_manager', {
        p_user_id: id, p_manager_email: body.manager_email,
      });
      if (error) throw new ApiError(error.message);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      const { error } = await supabase.rpc('admin_set_role', {
        p_user_id: id, p_role: body.role,
      });
      if (error) throw new ApiError(error.message);
    }
    if (body.deactivate === true) {
      const { error } = await supabase.rpc('admin_deactivate', { p_user_id: id });
      if (error) throw new ApiError(error.message);
    }
    return ok({ ok: true });
  }

  throw new ApiError(`Unhandled PUT ${url}`, 404);
}

async function del(url) {
  const viewer = await getViewer();

  if (/^\/users\/me\/skills\/\d+$/.test(url)) {
    const id = Number(url.split('/')[4]);
    const { error } = await supabase.from('skills').delete().eq('id', id).eq('user_id', viewer.id);
    if (error) throw new ApiError(error.message);
    await supabase.rpc('recompute_matches_for', { p_user_id: viewer.id });
    return ok({ ok: true });
  }
  if (/^\/users\/me\/career\/\d+$/.test(url)) {
    const id = Number(url.split('/')[4]);
    const { error } = await supabase.from('career_history').delete().eq('id', id).eq('user_id', viewer.id);
    if (error) throw new ApiError(error.message);
    await supabase.rpc('recompute_matches_for', { p_user_id: viewer.id });
    return ok({ ok: true });
  }
  if (/^\/reflections\/\d+$/.test(url)) {
    const id = Number(url.split('/')[2]);
    const { error } = await supabase.from('reflection_logs').delete().eq('id', id).eq('user_id', viewer.id);
    if (error) throw new ApiError(error.message);
    return ok({ ok: true });
  }
  if (/^\/users\/me\/unavailable-periods\/\d+$/.test(url)) {
    const id = Number(url.split('/')[4]);
    const { error } = await supabase.from('mentorship_unavailable_periods').delete().eq('id', id).eq('user_id', viewer.id);
    if (error) throw new ApiError(error.message);
    return ok({ ok: true });
  }
  throw new ApiError(`Unhandled DELETE ${url}`, 404);
}

const api = {
  get: (url, opts) => get(url, opts),
  post: (url, body, opts) => post(url, body, opts),
  put: (url, body, opts) => put(url, body, opts),
  delete: (url, opts) => del(url, opts),
};

export default api;
