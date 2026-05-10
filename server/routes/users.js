const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { computeMatchesForUser } = require('../utils/matching');

const router = express.Router();

const SENIORITY_ORDER = ['junior', 'mid', 'senior', 'lead'];

function computeBadges(userId) {
  const badges = [
    {
      id: 'first_step',
      label: 'First Step',
      description: 'Completed your first mentoring session',
      icon: '🌱',
      condition: 'Complete your first session'
    },
    {
      id: 'connector',
      label: 'Connector',
      description: 'Connected with colleagues from 3+ different departments',
      icon: '🔗',
      condition: 'Complete sessions with people from 3 different departments'
    },
    {
      id: 'deep_expert',
      label: 'Deep Expert',
      description: 'Requested as a mentor 5+ times',
      icon: '⭐',
      condition: 'Be requested as a mentor 5 times'
    },
    {
      id: 'explorer',
      label: 'Explorer',
      description: 'Ventured outside your department for a mentoring session',
      icon: '🧭',
      condition: 'Complete a session with someone from a completely different department'
    }
  ];

  const user = db.prepare('SELECT department FROM users WHERE id = ?').get(userId);

  const firstStep = db.prepare(
    `SELECT 1 FROM sessions WHERE (mentor_id=? OR mentee_id=?) AND status='completed' LIMIT 1`
  ).get(userId, userId);

  const deptRow = db.prepare(`
    SELECT COUNT(DISTINCT u.department) as cnt
    FROM sessions s
    JOIN users u ON u.id = CASE WHEN s.mentor_id=? THEN s.mentee_id ELSE s.mentor_id END
    WHERE (s.mentor_id=? OR s.mentee_id=?) AND s.status='completed'
  `).get(userId, userId, userId);

  const mentorCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM sessions WHERE mentor_id=?`
  ).get(userId);

  const explorer = user ? db.prepare(`
    SELECT 1 FROM sessions s
    JOIN users u ON u.id = CASE WHEN s.mentor_id=? THEN s.mentee_id ELSE s.mentor_id END
    WHERE (s.mentor_id=? OR s.mentee_id=?) AND u.department != ? AND s.status='completed'
    LIMIT 1
  `).get(userId, userId, userId, user.department) : null;

  return badges.map(b => ({
    ...b,
    earned: (
      (b.id === 'first_step' && !!firstStep) ||
      (b.id === 'connector' && (deptRow?.cnt >= 3)) ||
      (b.id === 'deep_expert' && (mentorCount?.cnt >= 5)) ||
      (b.id === 'explorer' && !!explorer)
    )
  }));
}

function getUserProfile(userId, viewerId) {
  const user = db.prepare(
    'SELECT id, email, name, department, seniority, current_role, tenure_years, location, bio, shadow_role_response, onboarding_complete, is_admin, created_at FROM users WHERE id = ?'
  ).get(userId);
  if (!user) return null;

  const skills = db.prepare('SELECT id, user_id, skill, type, example_project FROM skills WHERE user_id = ?').all(userId);
  const career = db.prepare('SELECT * FROM career_history WHERE user_id = ? ORDER BY start_year DESC').all(userId);
  const badges = computeBadges(userId);

  // Expertise signature: can_teach skills the user has actually mentored on a completed session
  const expertiseRaw = db.prepare(`
    SELECT DISTINCT s.skill FROM skills s
    JOIN sessions sess ON sess.mentor_id = s.user_id AND sess.status = 'completed'
    WHERE s.user_id = ? AND s.type = 'can_teach'
  `).all(userId);
  const expertiseSignature = expertiseRaw.map(r => r.skill);

  // Per-skill progress counts: for each can_teach skill, how many completed mentor sessions
  // included a mentee whose wants_to_learn list contained that skill (and vice versa for learn).
  const skillProgress = db.prepare(`
    SELECT s.id, s.skill, s.type, s.example_project,
      CASE WHEN s.type = 'can_teach' THEN (
        SELECT COUNT(*) FROM sessions sess
        WHERE sess.mentor_id = s.user_id
          AND sess.status = 'completed'
          AND EXISTS (
            SELECT 1 FROM skills s2
            WHERE s2.user_id = sess.mentee_id
              AND s2.type = 'wants_to_learn'
              AND LOWER(TRIM(s2.skill)) = LOWER(TRIM(s.skill))
          )
      ) ELSE (
        SELECT COUNT(*) FROM sessions sess
        WHERE sess.mentee_id = s.user_id
          AND sess.status = 'completed'
          AND EXISTS (
            SELECT 1 FROM skills s2
            WHERE s2.user_id = sess.mentor_id
              AND s2.type = 'can_teach'
              AND LOWER(TRIM(s2.skill)) = LOWER(TRIM(s.skill))
          )
      ) END as session_count
    FROM skills s
    WHERE s.user_id = ?
  `).all(userId);

  // shadow_role_response is private — only the user sees their own answer
  const isSelf = viewerId === userId;
  if (!isSelf) delete user.shadow_role_response;

  // wants_to_learn is private growth context — never expose to peers.
  // Filter both the raw skills list and the skillProgress aggregate.
  const visibleSkills = isSelf ? skills : skills.filter(s => s.type !== 'wants_to_learn');
  const visibleSkillProgress = isSelf
    ? skillProgress
    : skillProgress.filter(s => s.type !== 'wants_to_learn');

  // Direct-report count — controls Team Skills nav visibility on the client.
  // Only exposed to the user themselves (a peer profile shouldn't reveal that
  // someone is a manager).
  let direct_reports = 0;
  if (isSelf) {
    direct_reports = db.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE manager_id = ? AND is_admin = 0'
    ).get(userId).cnt;
  }

  return {
    ...user,
    skills: visibleSkills,
    career,
    badges,
    expertiseSignature,
    skillProgress: visibleSkillProgress,
    direct_reports,
  };
}

// Normalize a can_teach/wants_to_learn input into [{skill, example_project}]
function normalizeSkillsInput(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const entry of arr) {
    if (typeof entry === 'string') {
      const skill = entry.trim();
      if (skill) out.push({ skill, example_project: '' });
    } else if (entry && typeof entry === 'object' && typeof entry.skill === 'string') {
      const skill = entry.skill.trim();
      if (skill) out.push({ skill, example_project: (entry.example_project || '').toString().trim() });
    }
  }
  return out;
}

// GET /api/users/me
router.get('/me', authMiddleware, (req, res) => {
  const profile = getUserProfile(req.user.id, req.user.id);
  if (!profile) return res.status(404).json({ error: 'User not found' });
  res.json(profile);
});

// PUT /api/users/me — all fields are partial-update safe: a field absent from
// the request body is left untouched (no clobbering with empty strings).
router.put('/me', authMiddleware, (req, res) => {
  const body = req.body || {};
  const has = k => Object.prototype.hasOwnProperty.call(body, k);

  const validSeniority = ['junior','mid','senior','lead'];

  // Build an UPDATE that only sets fields actually present in the body
  const sets = [];
  const params = [];
  if (has('name'))                  { sets.push('name = ?');                  params.push(String(body.name || '').trim()); }
  if (has('department'))            { sets.push('department = ?');            params.push(String(body.department || '').trim()); }
  if (has('seniority'))             {
    const s = String(body.seniority || '').toLowerCase().trim();
    sets.push('seniority = ?');
    params.push(validSeniority.includes(s) ? s : 'junior');
  }
  if (has('current_role'))          { sets.push('current_role = ?');          params.push(String(body.current_role || '').trim()); }
  if (has('bio'))                   { sets.push('bio = ?');                   params.push(String(body.bio || '').trim()); }
  if (has('shadow_role_response')) { sets.push('shadow_role_response = ?');  params.push(String(body.shadow_role_response || '').trim()); }
  if (has('tenure_years'))          { sets.push('tenure_years = ?');          params.push(parseInt(body.tenure_years) || 0); }
  if (has('location'))              { sets.push('location = ?');              params.push(String(body.location || '').trim()); }

  if (sets.length > 0) {
    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json(getUserProfile(req.user.id, req.user.id));
});

// POST /api/users/me/onboarding
router.post('/me/onboarding', authMiddleware, (req, res) => {
  const { career, can_teach, wants_to_learn, name, department, seniority, current_role, bio, shadow_role_response, tenure_years, location } = req.body;

  db.prepare(`
    UPDATE users SET name=?, department=?, seniority=?, current_role=?, bio=?,
      shadow_role_response=?, tenure_years=?, location=?, onboarding_complete=1
    WHERE id=?
  `).run(
    name || '',
    department || '',
    seniority || 'junior',
    current_role || '',
    bio || '',
    shadow_role_response || '',
    parseInt(tenure_years) || 0,
    location || '',
    req.user.id
  );

  // Replace career history
  db.prepare('DELETE FROM career_history WHERE user_id = ?').run(req.user.id);
  if (Array.isArray(career)) {
    const insertCareer = db.prepare(
      'INSERT INTO career_history (user_id, role, department, company, description, start_year, end_year) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const entry of career) {
      if (entry.role && entry.department) {
        insertCareer.run(
          req.user.id,
          entry.role,
          entry.department,
          entry.company || '',
          entry.description || '',
          entry.start_year || null,
          entry.end_year || null
        );
      }
    }
  }

  // Replace skills (accepts strings or {skill, example_project})
  db.prepare('DELETE FROM skills WHERE user_id = ?').run(req.user.id);
  const insertSkill = db.prepare('INSERT INTO skills (user_id, skill, type, example_project) VALUES (?, ?, ?, ?)');
  for (const { skill, example_project } of normalizeSkillsInput(can_teach)) {
    insertSkill.run(req.user.id, skill, 'can_teach', example_project);
  }
  for (const { skill } of normalizeSkillsInput(wants_to_learn)) {
    // example_project doesn't apply to wants_to_learn
    insertSkill.run(req.user.id, skill, 'wants_to_learn', '');
  }

  // Trigger match computation for this user
  try {
    computeMatchesForUser(req.user.id);
  } catch (e) {
    console.error('Match computation error:', e);
  }

  res.json(getUserProfile(req.user.id, req.user.id));
});

// GET /api/users/:id  (public profile)
router.get('/:id', authMiddleware, (req, res) => {
  const profile = getUserProfile(parseInt(req.params.id), req.user.id);
  if (!profile) return res.status(404).json({ error: 'User not found' });
  res.json(profile);
});

// POST /api/users/me/skills
router.post('/me/skills', authMiddleware, (req, res) => {
  const { skill, type, example_project } = req.body;
  if (!skill || !['can_teach', 'wants_to_learn'].includes(type)) {
    return res.status(400).json({ error: 'skill and type (can_teach|wants_to_learn) required' });
  }
  const example = type === 'can_teach' ? (example_project || '').toString().trim() : '';
  const result = db.prepare(
    'INSERT INTO skills (user_id, skill, type, example_project) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, skill.trim(), type, example);
  computeMatchesForUser(req.user.id);
  res.status(201).json({ id: result.lastInsertRowid, skill: skill.trim(), type, example_project: example });
});

// PUT /api/users/me/skills/:id  — update example_project for a can_teach skill
router.put('/me/skills/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Skill not found' });
  const example = (req.body.example_project || '').toString().trim();
  db.prepare('UPDATE skills SET example_project = ? WHERE id = ?').run(example, id);
  res.json({ ...existing, example_project: example });
});

// DELETE /api/users/me/skills/:id
router.delete('/me/skills/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM skills WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.user.id);
  computeMatchesForUser(req.user.id);
  res.json({ ok: true });
});

// POST /api/users/me/career
router.post('/me/career', authMiddleware, (req, res) => {
  const { role, department, company, description, start_year, end_year } = req.body;
  if (!role || !department) {
    return res.status(400).json({ error: 'role and department required' });
  }
  const result = db.prepare(
    'INSERT INTO career_history (user_id, role, department, company, description, start_year, end_year) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, role, department, company || '', description || '', start_year || null, end_year || null);
  computeMatchesForUser(req.user.id);
  res.status(201).json({ id: result.lastInsertRowid, role, department, company, description, start_year, end_year });
});

// DELETE /api/users/me/career/:id
router.delete('/me/career/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM career_history WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.user.id);
  computeMatchesForUser(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
