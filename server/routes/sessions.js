const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { generateIcs } = require('../utils/icsGenerator');
const { auditLog } = require('../utils/auditLog');

const router = express.Router();

// Derive the "topics covered" for a session by intersecting the mentor's
// can_teach skills with the mentee's wants_to_learn skills. This is an
// approximation (uses current skill state, not a snapshot from the time of
// the session) but it gives the UI something concrete to label past meetings
// with — something better than just the generic title.
function computeSessionTopics(mentorId, menteeId) {
  const mentorTeach = db.prepare(
    "SELECT skill FROM skills WHERE user_id = ? AND type = 'can_teach'"
  ).all(mentorId).map(r => ({ raw: r.skill, lc: r.skill.toLowerCase().trim() }));
  const menteeWants = new Set(
    db.prepare(
      "SELECT skill FROM skills WHERE user_id = ? AND type = 'wants_to_learn'"
    ).all(menteeId).map(r => r.skill.toLowerCase().trim())
  );
  return mentorTeach
    .filter(s => menteeWants.has(s.lc))
    .map(s => s.raw)
    .slice(0, 5);
}

function enrichSession(session, currentUserId) {
  const mentor = db.prepare('SELECT id, name, email, department, seniority, current_role FROM users WHERE id = ?').get(session.mentor_id);
  const mentee = db.prepare('SELECT id, name, email, department, seniority, current_role FROM users WHERE id = ?').get(session.mentee_id);
  const isMentor = session.mentor_id === currentUserId;
  const isMentee = session.mentee_id === currentUserId;

  // Topics: explicit if the mentee picked them at request time, otherwise
  // derived from current can_teach ∩ wants_to_learn as a best-effort fallback.
  let topics = [];
  try {
    const parsed = JSON.parse(session.topics || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) topics = parsed;
  } catch { /* empty */ }
  if (topics.length === 0) {
    topics = computeSessionTopics(session.mentor_id, session.mentee_id);
  }

  return {
    ...session,
    mentor,
    mentee,
    isMentor,
    isMentee,
    topics,
    // Each side sees only their own reflection — mentor and mentee both have
    // their own private write-up.
    reflection: isMentee ? session.reflection : undefined,
    mentor_reflection: isMentor ? session.mentor_reflection : undefined,
    // Same privacy rule for ratings: only the rater sees their own rating.
    // The other party never sees how they were rated — this preserves honesty
    // and prevents performative 5-star scoring.
    mentee_rating: isMentee ? session.mentee_rating : undefined,
    mentor_rating: isMentor ? session.mentor_rating : undefined,
  };
}

// GET /api/sessions
router.get('/', authMiddleware, (req, res) => {
  const sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE mentor_id = ? OR mentee_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id, req.user.id);

  res.json(sessions.map(s => enrichSession(s, req.user.id)));
});

// GET /api/sessions/:id
router.get('/:id', authMiddleware, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.mentor_id !== req.user.id && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(enrichSession(session, req.user.id));
});

// POST /api/sessions
router.post('/', authMiddleware, (req, res) => {
  const { mentor_id, title, scheduled_at, duration_minutes, pre_session_question, topics } = req.body;
  if (!mentor_id || !title) {
    return res.status(400).json({ error: 'mentor_id and title are required' });
  }
  if (mentor_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot book a session with yourself' });
  }

  const mentor = db.prepare('SELECT id FROM users WHERE id = ?').get(mentor_id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found' });

  // Sanitize topics: accept only strings that match a real can_teach skill
  // belonging to this mentor — prevents the mentee from inventing arbitrary
  // labels and tags that the mentor doesn't actually claim.
  const allowedTopics = new Set(
    db.prepare("SELECT skill FROM skills WHERE user_id = ? AND type = 'can_teach'")
      .all(mentor_id)
      .map(r => r.skill.toLowerCase().trim())
  );
  const cleanTopics = Array.isArray(topics)
    ? [...new Set(
        topics
          .map(t => (t || '').toString().trim())
          .filter(t => t && allowedTopics.has(t.toLowerCase()))
      )].slice(0, 6)
    : [];

  const result = db.prepare(`
    INSERT INTO sessions (mentor_id, mentee_id, title, scheduled_at, duration_minutes, pre_session_question, topics, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    mentor_id,
    req.user.id,
    title,
    scheduled_at || null,
    duration_minutes || 60,
    pre_session_question || '',
    JSON.stringify(cleanTopics),
  );

  auditLog(req, 'session.request', 'session', result.lastInsertRowid, {
    mentor_id,
    topic_count: cleanTopics.length,
  });

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(enrichSession(session, req.user.id));
});

// PUT /api/sessions/:id
router.put('/:id', authMiddleware, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.mentor_id !== req.user.id && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { status, scheduled_at, reflection, mentor_reflection, mentee_rating, mentor_rating } = req.body;

  // Only mentor can accept (change pending -> scheduled)
  if (status === 'scheduled' && session.mentor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the mentor can accept a session request' });
  }
  // Mentee writes the mentee reflection + rating; mentor writes the mentor's.
  if (reflection !== undefined && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the mentee can add a mentee reflection' });
  }
  if (mentor_reflection !== undefined && session.mentor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the mentor can add a mentor reflection' });
  }
  if (mentee_rating !== undefined && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the mentee can set the mentee rating' });
  }
  if (mentor_rating !== undefined && session.mentor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the mentor can set the mentor rating' });
  }
  // Sanitize ratings to 1-5 integer, or null to clear
  const cleanRating = (v) => {
    if (v === null) return null;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 5) return undefined; // ignore garbage
    return n;
  };

  const updates = {};
  if (status) updates.status = status;
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at;
  if (reflection !== undefined) updates.reflection = reflection;
  if (mentor_reflection !== undefined) updates.mentor_reflection = mentor_reflection;
  if (mentee_rating !== undefined) {
    const r = cleanRating(mentee_rating);
    if (r !== undefined) updates.mentee_rating = r;
  }
  if (mentor_rating !== undefined) {
    const r = cleanRating(mentor_rating);
    if (r !== undefined) updates.mentor_rating = r;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), session.id];
  db.prepare(`UPDATE sessions SET ${setClauses} WHERE id = ?`).run(...values);

  // Audit transitions, not the reflection text itself
  if (status === 'scheduled') {
    auditLog(req, 'session.accept', 'session', session.id);
  } else if (status === 'completed') {
    auditLog(req, 'session.complete', 'session', session.id, {
      role: req.user.id === session.mentor_id ? 'mentor' : 'mentee',
      has_reflection: !!(reflection || mentor_reflection),
    });
  } else if (status === 'declined' || status === 'cancelled') {
    auditLog(req, 'session.cancel', 'session', session.id);
  } else if (scheduled_at !== undefined && status === undefined) {
    auditLog(req, 'session.reschedule', 'session', session.id);
  } else if (
    status === undefined && scheduled_at === undefined &&
    (reflection !== undefined || mentor_reflection !== undefined)
  ) {
    // Retroactive reflection edit on an already-completed session
    auditLog(req, 'session.reflection_added', 'session', session.id, {
      role: reflection !== undefined ? 'mentee' : 'mentor',
    });
  }
  if (mentee_rating !== undefined || mentor_rating !== undefined) {
    // Ratings — auditable because they feed the matching algorithm
    auditLog(req, 'session.rated', 'session', session.id, {
      role: mentor_rating !== undefined ? 'mentor' : 'mentee',
      rating: mentor_rating ?? mentee_rating ?? null,
    });
  }

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
  res.json(enrichSession(updated, req.user.id));
});

// GET /api/sessions/:id/ics
router.get('/:id/ics', authMiddleware, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.mentor_id !== req.user.id && session.mentee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!session.scheduled_at) {
    return res.status(400).json({ error: 'Session has no scheduled time' });
  }

  const mentor = db.prepare('SELECT * FROM users WHERE id = ?').get(session.mentor_id);
  const mentee = db.prepare('SELECT * FROM users WHERE id = ?').get(session.mentee_id);

  const icsContent = generateIcs(session, mentor, mentee);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.ics"`);
  res.send(icsContent);
});

module.exports = router;
