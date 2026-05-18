const express = require('express');
const db = require('../db/database');
const { classifyReflection } = require('../utils/reflectionClassifier');
const { computeMatchesForUser } = require('../utils/matching');
const { auditLog } = require('../utils/auditLog');

const router = express.Router();

function format(row) {
  if (!row) return null;
  return {
    id: row.id,
    support_needed: row.support_needed,
    managed_well: row.managed_well,
    extracted_gaps: JSON.parse(row.extracted_gaps || '[]'),
    extracted_strengths: JSON.parse(row.extracted_strengths || '[]'),
    esco_uris: JSON.parse(row.esco_uris || '{}'),
    classifier_source: row.classifier_source,
    applied: !!row.applied,
    created_at: row.created_at
  };
}

// GET /api/reflections — own log, most recent first. Also includes "due" hint.
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM reflection_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  const last = rows[0];
  const lastDays = last
    ? Math.floor((Date.now() - new Date(last.created_at + 'Z').getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const userRow = db.prepare('SELECT pending_checkin FROM users WHERE id = ?').get(req.user.id);
  const pendingFromAdmin = !!userRow?.pending_checkin;
  // Prompt is due if an admin broadcast is pending, OR if no entry exists,
  // OR if the last entry is ≥ 4 days old (1-2 times a week cadence)
  const dueFromTime = lastDays === null || lastDays >= 4;
  res.json({
    entries: rows.map(format),
    dueForCheckIn: pendingFromAdmin || dueFromTime,
    pendingFromAdmin,
    lastEntryDays: lastDays
  });
});

// POST /api/reflections — submit a new check-in. Classifies inline.
router.post('/', async (req, res) => {
  const supportNeeded = (req.body?.support_needed || '').trim();
  const managedWell = (req.body?.managed_well || '').trim();
  if (!supportNeeded && !managedWell) {
    return res.status(400).json({ error: 'Please answer at least one of the two questions.' });
  }

  let classified;
  try {
    classified = await classifyReflection({ supportNeeded, managedWell });
  } catch (e) {
    classified = { gaps: [], strengths: [], esco_uris: {}, source: 'error' };
  }

  const result = db.prepare(`
    INSERT INTO reflection_logs
      (user_id, support_needed, managed_well, extracted_gaps, extracted_strengths, esco_uris, classifier_source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    supportNeeded,
    managedWell,
    JSON.stringify(classified.gaps),
    JSON.stringify(classified.strengths),
    JSON.stringify(classified.esco_uris || {}),
    classified.source
  );

  // Submitting a reflection clears any pending admin nudge for this user
  db.prepare('UPDATE users SET pending_checkin = 0 WHERE id = ?').run(req.user.id);

  // Audit the submission — only counts, never the text content
  auditLog(req, 'reflection.submit', 'reflection', result.lastInsertRowid, {
    classifier: classified.source,
    gap_count: classified.gaps.length,
    strength_count: classified.strengths.length,
  });

  const row = db.prepare('SELECT * FROM reflection_logs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(format(row));
});

// POST /api/reflections/:id/apply — apply some/all extracted skills to the profile.
// Body: { gaps?: string[], strengths?: string[] } — when omitted, applies all extracted.
router.post('/:id/apply', (req, res) => {
  const id = parseInt(req.params.id);
  const log = db.prepare('SELECT * FROM reflection_logs WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!log) return res.status(404).json({ error: 'Reflection not found' });

  const fallbackGaps = JSON.parse(log.extracted_gaps || '[]');
  const fallbackStrengths = JSON.parse(log.extracted_strengths || '[]');
  const acceptGaps = Array.isArray(req.body?.gaps) ? req.body.gaps : fallbackGaps;
  const acceptStrengths = Array.isArray(req.body?.strengths) ? req.body.strengths : fallbackStrengths;

  const existing = db.prepare('SELECT skill, type FROM skills WHERE user_id = ?').all(req.user.id);
  const existsKey = new Set(existing.map(s => `${s.type}::${s.skill.toLowerCase().trim()}`));

  const insert = db.prepare('INSERT INTO skills (user_id, skill, type, example_project) VALUES (?, ?, ?, ?)');
  let added = 0;
  const addedSkills = [];
  for (const raw of acceptGaps) {
    const skill = (raw || '').toString().trim();
    if (!skill) continue;
    const key = `wants_to_learn::${skill.toLowerCase()}`;
    if (!existsKey.has(key)) {
      insert.run(req.user.id, skill, 'wants_to_learn', '');
      existsKey.add(key);
      added++;
      addedSkills.push({ skill, type: 'wants_to_learn' });
    }
  }
  for (const raw of acceptStrengths) {
    const skill = (raw || '').toString().trim();
    if (!skill) continue;
    const key = `can_teach::${skill.toLowerCase()}`;
    if (!existsKey.has(key)) {
      insert.run(req.user.id, skill, 'can_teach', '');
      existsKey.add(key);
      added++;
      addedSkills.push({ skill, type: 'can_teach' });
    }
  }

  db.prepare('UPDATE reflection_logs SET applied = 1 WHERE id = ?').run(id);

  auditLog(req, 'reflection.apply', 'reflection', id, { added });

  // Recompute matches so the new skills affect Explorer + Dashboard immediately
  try { computeMatchesForUser(req.user.id); } catch (e) { /* non-fatal */ }

  res.json({ added, addedSkills });
});

// DELETE /api/reflections/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reflection_logs WHERE id = ? AND user_id = ?')
    .run(parseInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
