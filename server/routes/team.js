const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Privacy gate: refuse to expose any aggregate report when the manager has
// fewer than this many direct reports. Below the threshold a "report" can be
// trivially de-anonymized, which would defeat the purpose of the report.
const MIN_REPORTS_FOR_REPORT = 3;

// GET /api/team/skill-gaps
// Returns an anonymized ranking of the most common "wants_to_learn" skills
// across the current user's direct reports — plus, for context, the most
// common "can_teach" skills. No names, no ids, no per-employee breakdown.
router.get('/skill-gaps', authMiddleware, (req, res) => {
  const reports = db.prepare(
    'SELECT id FROM users WHERE manager_id = ? AND is_admin = 0'
  ).all(req.user.id);

  const reportCount = reports.length;
  if (reportCount === 0) {
    return res.json({
      reportCount: 0,
      gated: false,
      gaps: [],
      strengths: [],
      message: 'You have no direct reports linked in MENT.',
    });
  }

  if (reportCount < MIN_REPORTS_FOR_REPORT) {
    return res.json({
      reportCount,
      gated: true,
      minRequired: MIN_REPORTS_FOR_REPORT,
      gaps: [],
      strengths: [],
      message:
        `Reports are anonymized — you need at least ${MIN_REPORTS_FOR_REPORT} direct ` +
        `reports for a meaningful, de-identified picture. You currently have ${reportCount}.`,
    });
  }

  // Aggregate skill frequency, lowercase-deduped within each report so a
  // person doesn't get double-counted for the same skill listed twice.
  const placeholders = reports.map(() => '?').join(',');
  const ids = reports.map(r => r.id);

  const aggregate = (type) => {
    const rows = db.prepare(`
      SELECT user_id, LOWER(TRIM(skill)) as norm, MAX(skill) as display
      FROM skills
      WHERE type = ? AND user_id IN (${placeholders})
      GROUP BY user_id, norm
    `).all(type, ...ids);

    const counts = new Map(); // norm → { display, count }
    for (const r of rows) {
      const cur = counts.get(r.norm) || { display: r.display, count: 0 };
      cur.count += 1;
      counts.set(r.norm, cur);
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
      .map(c => ({
        skill: c.display,
        count: c.count,
        share: Math.round((c.count / reportCount) * 100),
      }))
      .slice(0, 5);
  };

  const gaps = aggregate('wants_to_learn');
  const strengths = aggregate('can_teach');

  res.json({
    reportCount,
    gated: false,
    gaps,
    strengths,
    message: null,
  });
});

module.exports = router;
