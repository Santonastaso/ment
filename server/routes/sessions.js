const express = require('express');
const db = require('../db/database');
const { generateIcs } = require('../utils/icsGenerator');
const { auditLog } = require('../utils/auditLog');

const router = express.Router();

// Derive "topics covered" from current can_teach ∩ wants_to_learn — used both
// at request time (snapshot into sessions.topics) and as a render-time fallback
// for legacy rows that have no snapshot.
function computeSessionTopics(mentorId, menteeId) {
  const mentorTeach = db.prepare(
    "SELECT skill FROM skills WHERE user_id = ? AND type = 'can_teach'"
  ).all(mentorId).map(r => ({ raw: r.skill, lc: r.skill.toLowerCase().trim() }));
  const menteeWants = new Set(
    db.prepare("SELECT skill FROM skills WHERE user_id = ? AND type = 'wants_to_learn'")
      .all(menteeId).map(r => r.skill.toLowerCase().trim())
  );
  return mentorTeach.filter(s => menteeWants.has(s.lc)).map(s => s.raw).slice(0, 5);
}

// SQLite stores datetimes as 'YYYY-MM-DD HH:MM:SS' (no timezone). Treat them as UTC.
function sqliteToDate(s) {
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function enrichSession(session, viewerId) {
  const mentor = db.prepare(
    'SELECT id, name, email, department, seniority, current_role, deactivated_at FROM users WHERE id = ?'
  ).get(session.mentor_id);
  const mentee = db.prepare(
    'SELECT id, name, email, department, seniority, current_role, deactivated_at FROM users WHERE id = ?'
  ).get(session.mentee_id);
  if (mentor?.deactivated_at) mentor.name = '[Former colleague]';
  if (mentee?.deactivated_at) mentee.name = '[Former colleague]';

  const isMentor = session.mentor_id === viewerId;
  const isMentee = session.mentee_id === viewerId;

  let topics = [];
  try {
    const parsed = JSON.parse(session.topics || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) topics = parsed;
  } catch { /* invalid JSON — fall through to derived */ }
  if (topics.length === 0) topics = computeSessionTopics(session.mentor_id, session.mentee_id);

  const scheduledAt = sqliteToDate(session.scheduled_at);
  const myCompleted = isMentor ? session.mentor_completed_at : session.mentee_completed_at;
  const needs_my_completion = !!(
    (isMentor || isMentee) && scheduledAt && scheduledAt < new Date() && !myCompleted
  );

  return {
    ...session,
    mentor,
    mentee,
    isMentor,
    isMentee,
    topics,
    needs_my_completion,
    // Each role only sees their own private reflection / rating / pre-session question.
    reflection: isMentee ? session.reflection : undefined,
    mentor_reflection: isMentor ? session.mentor_reflection : undefined,
    mentee_rating: isMentee ? session.mentee_rating : undefined,
    mentor_rating: isMentor ? session.mentor_rating : undefined,
    pre_session_question: isMentor ? session.pre_session_question : undefined,
  };
}

const sanitizeRating = (v) => {
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined;
};

// GET /api/sessions
router.get('/', (req, res) => {
  const sessions = db.prepare(`
    SELECT * FROM sessions WHERE mentor_id = ? OR mentee_id = ? ORDER BY created_at DESC
  `).all(req.user.id, req.user.id);
  res.json(sessions.map(s => enrichSession(s, req.user.id)));
});

// GET /api/sessions/:id
router.get('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.mentor_id !== req.user.id && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(enrichSession(session, req.user.id));
});

// POST /api/sessions
router.post('/', (req, res) => {
  const { mentor_id, title, scheduled_at, duration_minutes, pre_session_question, topics } = req.body;
  if (!mentor_id || !title) {
    return res.status(400).json({ error: 'mentor_id and title are required' });
  }
  if (mentor_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot book a session with yourself' });
  }
  const mentor = db.prepare(
    'SELECT id, deactivated_at FROM users WHERE id = ?'
  ).get(mentor_id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
  if (mentor.deactivated_at) return res.status(400).json({ error: 'Mentor account is deactivated' });

  // Mentee can only pick topics the mentor actually claims; snapshot the overlap
  // when nothing valid was sent so the historical record is stable.
  const allowedTopics = new Set(
    db.prepare("SELECT skill FROM skills WHERE user_id = ? AND type = 'can_teach'")
      .all(mentor_id).map(r => r.skill.toLowerCase().trim())
  );
  let cleanTopics = Array.isArray(topics)
    ? [...new Set(topics.map(t => (t || '').toString().trim())
        .filter(t => t && allowedTopics.has(t.toLowerCase())))].slice(0, 6)
    : [];
  if (cleanTopics.length === 0) cleanTopics = computeSessionTopics(mentor_id, req.user.id);

  const result = db.prepare(`
    INSERT INTO sessions
      (mentor_id, mentee_id, title, scheduled_at, duration_minutes, pre_session_question, topics, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    mentor_id, req.user.id, title,
    scheduled_at || null, duration_minutes || 60,
    pre_session_question || '', JSON.stringify(cleanTopics),
  );

  auditLog(req, 'session.request', 'session', result.lastInsertRowid, {
    mentor_id, topic_count: cleanTopics.length,
  });

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(enrichSession(session, req.user.id));
});

// PUT /api/sessions/:id
router.put('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const viewerIsMentor = session.mentor_id === req.user.id;
  const viewerIsMentee = session.mentee_id === req.user.id;
  if (!viewerIsMentor && !viewerIsMentee) return res.status(403).json({ error: 'Forbidden' });

  const { status, scheduled_at, reflection, mentor_reflection, mentee_rating, mentor_rating } = req.body;

  if (status === 'scheduled' && !viewerIsMentor) {
    return res.status(403).json({ error: 'Only the mentor can accept a session request' });
  }
  if (reflection !== undefined && !viewerIsMentee) {
    return res.status(403).json({ error: 'Only the mentee can add a mentee reflection' });
  }
  if (mentor_reflection !== undefined && !viewerIsMentor) {
    return res.status(403).json({ error: 'Only the mentor can add a mentor reflection' });
  }
  if (mentee_rating !== undefined && !viewerIsMentee) {
    return res.status(403).json({ error: 'Only the mentee can set the mentee rating' });
  }
  if (mentor_rating !== undefined && !viewerIsMentor) {
    return res.status(403).json({ error: 'Only the mentor can set the mentor rating' });
  }

  const updates = {};
  let markedSideComplete = false;
  let bothCompleted = false;

  // Per-role completion: mark this viewer's column, only flip status when both have marked.
  if (status === 'completed') {
    markedSideComplete = true;
    const col = viewerIsMentor ? 'mentor_completed_at' : 'mentee_completed_at';
    db.prepare(`UPDATE sessions SET ${col} = datetime('now') WHERE id = ?`).run(session.id);
    const fresh = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
    bothCompleted = !!(fresh.mentor_completed_at && fresh.mentee_completed_at);
    if (bothCompleted) updates.status = 'completed';
  } else if (status) {
    updates.status = status;
  }

  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at;
  if (reflection !== undefined) updates.reflection = reflection;
  if (mentor_reflection !== undefined) updates.mentor_reflection = mentor_reflection;
  if (mentee_rating !== undefined) {
    const r = sanitizeRating(mentee_rating);
    if (r !== undefined) updates.mentee_rating = r;
  }
  if (mentor_rating !== undefined) {
    const r = sanitizeRating(mentor_rating);
    if (r !== undefined) updates.mentor_rating = r;
  }

  if (!markedSideComplete && Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE sessions SET ${setClauses} WHERE id = ?`)
      .run(...Object.values(updates), session.id);
  }

  // Audit transitions — never the reflection text itself.
  if (status === 'scheduled') {
    auditLog(req, 'session.accept', 'session', session.id);
  } else if (markedSideComplete) {
    auditLog(req, 'session.complete', 'session', session.id, {
      role: viewerIsMentor ? 'mentor' : 'mentee',
      both_done: bothCompleted,
      has_reflection: !!(reflection || mentor_reflection),
    });
  } else if (status === 'declined' || status === 'cancelled') {
    auditLog(req, 'session.cancel', 'session', session.id);
  } else if (scheduled_at !== undefined && status === undefined) {
    auditLog(req, 'session.reschedule', 'session', session.id);
  } else if (reflection !== undefined || mentor_reflection !== undefined) {
    auditLog(req, 'session.reflection_added', 'session', session.id, {
      role: reflection !== undefined ? 'mentee' : 'mentor',
    });
  }
  if (mentee_rating !== undefined || mentor_rating !== undefined) {
    auditLog(req, 'session.rated', 'session', session.id, {
      role: mentor_rating !== undefined ? 'mentor' : 'mentee',
      rating: mentor_rating ?? mentee_rating ?? null,
    });
  }

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
  res.json(enrichSession(updated, req.user.id));
});

// GET /api/sessions/:id/ics
router.get('/:id/ics', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.mentor_id !== req.user.id && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!session.scheduled_at) return res.status(400).json({ error: 'Session has no scheduled time' });

  const mentor = db.prepare('SELECT * FROM users WHERE id = ?').get(session.mentor_id);
  const mentee = db.prepare('SELECT * FROM users WHERE id = ?').get(session.mentee_id);
  const ics = generateIcs(session, mentor, mentee);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.ics"`);
  res.send(ics);
});

router.enrichSession = enrichSession;
module.exports = router;
