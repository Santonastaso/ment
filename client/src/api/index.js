// Backwards-compatible API shim. Routes legacy `api.get/post/put/delete(...)`
// calls to Supabase: direct PostgREST queries, RPCs, or Edge Functions.
//
// This is a translation layer kept tight on purpose. New code should call
// `supabase` directly from `client/src/lib/supabase.js`.

import { supabase } from '../lib/supabase.js';

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.response = { status, data: { error: message } };
  }
}

function ok(data, status = 200) {
  return { data, status };
}

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
  return (rows || []).map((c) => ({ ...c, role: c.role_title }));
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
        out.push(`${them} can teach ${skills} — areas you're growing in`);
      } else if (r.teacher_id === viewer.id) {
        if (mentorOnly) continue;
        out.push(`You can teach ${skills} — and ${them} wants to learn it`);
      }
    } else if (r.type === 'career_bridge') {
      if (r.who_id === other.id) {
        out.push(`${them} has worked in ${r.into_dept} before — they understand your world`);
      } else if (r.who_id === viewer.id) {
        if (mentorOnly) continue;
        out.push(`You've worked in ${other.department} — common ground with ${them}`);
      }
    } else if (r.type === 'dept_diversity') {
      const otherDept = r.a_id === other.id ? r.a_dept : r.b_dept;
      const yourDept = r.a_id === viewer.id ? r.a_dept : r.b_dept;
      out.push(`${them} works in ${otherDept} — a fresh angle from ${yourDept}`);
    }
  }
  return out;
}

// ============================================================
// Profile composition for /users/me and /users/:id
// ============================================================

const PROFILE_FIELDS =
  'id, name, department, seniority, job_title, tenure_years, location, bio, ' +
  'shadow_role_response, pending_checkin, manager_id, must_change_password, ' +
  'deactivated_at, onboarding_complete, is_admin, admin_scope, organization_id, created_at';

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

  const { data: row, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', userId)
    .single();
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

  return {
    ...session,
    mentor,
    mentee,
    isMentor,
    isMentee,
    topics,
    needs_my_completion,
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
    const reasons = [...renderedBase, ...(m.extraReasons || [])];
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
  if (url.startsWith('/sessions/') && !url.endsWith('/ics')) {
    const id = Number(url.slice('/sessions/'.length));
    const { data, error } = await supabase.rpc('my_session', { p_session_id: id });
    if (error) throw new ApiError(error.message, 404);
    return ok(await enrichSession(data, viewer.id));
  }

  if (url === '/connections') {
    const { data, error } = await supabase
      .from('connections')
      .select('*')
      .or(`requester_id.eq.${viewer.id},addressee_id.eq.${viewer.id}`)
      .order('created_at', { ascending: false });
    if (error) throw new ApiError(error.message);
    return ok(data || []);
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
  if (url === '/admin/owner-stats') {
    const { data, error } = await supabase.rpc('platform_owner_stats');
    if (error) throw new ApiError(error.message);
    return ok(data);
  }
  if (url.startsWith('/admin/users/')) {
    const id = url.slice('/admin/users/'.length);
    const { data, error } = await supabase.rpc('admin_user_detail', { p_user_id: id });
    if (error) throw new ApiError(error.message, 404);
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

  if (url === '/users/me/career') {
    const payload = {
      user_id: viewer.id,
      role_title: body.role,
      department: body.department,
      company: body.company || '',
      description: body.description || '',
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
        description: c.description || '',
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

  if (url === '/connections') {
    const { data, error } = await supabase.rpc('upsert_connection', {
      p_addressee_id: body.addressee_id,
      p_status: body.status || 'pending',
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
    // Best-effort classification (Edge Function); ignore failures
    try {
      await supabase.functions.invoke('reflection-classify', { body: { reflection_log_id: row.id } });
    } catch { /* noop */ }
    return ok({ ...row, applied: false }, 201);
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
      body: { storage_path: path, kind },
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
    const allowed = ['name', 'department', 'seniority', 'bio', 'shadow_role_response', 'tenure_years', 'location'];
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
      // Field-only update (reflection text, rating after-the-fact)
      const update = {};
      if (Object.prototype.hasOwnProperty.call(body, 'reflection')) update.reflection = body.reflection;
      if (Object.prototype.hasOwnProperty.call(body, 'mentor_reflection')) update.mentor_reflection = body.mentor_reflection;
      if (Object.prototype.hasOwnProperty.call(body, 'mentee_rating')) update.mentee_rating = body.mentee_rating;
      if (Object.prototype.hasOwnProperty.call(body, 'mentor_rating')) update.mentor_rating = body.mentor_rating;
      const { data, error } = await supabase.from('sessions').update(update).eq('id', id).select().single();
      if (error) throw new ApiError(error.message);
      session = data;
    }
    return ok(await enrichSession(session, viewer.id));
  }

  if (/^\/connections\/\d+$/.test(url)) {
    const id = Number(url.split('/')[2]);
    const { data, error } = await supabase.rpc('update_connection_status', {
      p_id: id, p_status: body.status,
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
  throw new ApiError(`Unhandled DELETE ${url}`, 404);
}

const api = {
  get: (url, opts) => get(url, opts),
  post: (url, body, opts) => post(url, body, opts),
  put: (url, body, opts) => put(url, body, opts),
  delete: (url, opts) => del(url, opts),
};

export default api;
