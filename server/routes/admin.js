const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { computeAllMatches } = require('../utils/matching');
const { auditLog } = require('../utils/auditLog');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const DEFAULT_PASSWORD = 'ment2026';

// GET /api/admin/stats
router.get('/stats', authMiddleware, adminOnly, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0').get().cnt;
  const onboarded = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0 AND onboarding_complete = 1').get().cnt;

  const sessionsByStatus = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM sessions GROUP BY status
  `).all();

  const topMentors = db.prepare(`
    SELECT u.id, u.name, u.department, u.seniority, COUNT(s.id) as session_count
    FROM users u
    JOIN sessions s ON s.mentor_id = u.id AND s.status = 'completed'
    GROUP BY u.id
    ORDER BY session_count DESC
    LIMIT 5
  `).all();

  const deptActivity = db.prepare(`
    SELECT u.department,
      COUNT(DISTINCT s.id) as session_count
    FROM users u
    LEFT JOIN sessions s ON (s.mentor_id = u.id OR s.mentee_id = u.id) AND s.status = 'completed'
    WHERE u.is_admin = 0
    GROUP BY u.department
    ORDER BY session_count ASC
  `).all();

  const totalMatches = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;

  res.json({
    totalUsers,
    onboardingRate: totalUsers > 0 ? Math.round((onboarded / totalUsers) * 100) : 0,
    onboarded,
    sessionsByStatus,
    topMentors,
    deptActivity,
    totalMatches
  });
});

// POST /api/admin/upload
router.post('/upload', authMiddleware, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file. Ensure it is a valid CSV or XLSX.' });
  }

  if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

  // Normalize column names
  const normalized = rows.map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), String(v).trim()]))
  );

  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (email, password_hash, name, department, seniority, current_role, tenure_years, location, onboarding_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const insertSkill = db.prepare('INSERT INTO skills (user_id, skill, type) VALUES (?, ?, ?)');

  let imported = 0;
  // Track manager assignments to apply in a second pass (manager may not exist
  // yet at the moment a row is processed if both are in the same upload).
  const pendingManagerLinks = []; // {userId, managerEmail}
  const importMany = db.transaction(() => {
    for (const row of normalized) {
      const email = (row.email || '').toLowerCase().trim();
      const name = row.name || row.full_name || '';
      if (!email || !name) continue;

      const dept = row.department || '';
      const role = row.current_role || row.role || '';
      const seniority = ['junior', 'mid', 'senior', 'lead'].includes(row.seniority) ? row.seniority : 'junior';
      const tenure = parseInt(row.tenure_years) || 0;
      const location = (row.location || '').trim();
      const managerEmail = (row.manager_email || row.manager || '').toLowerCase().trim();

      const result = insertUser.run(email, passwordHash, name, dept, seniority, role, tenure, location);
      if (result.changes === 0) continue; // already exists

      const userId = result.lastInsertRowid;
      imported++;

      if (managerEmail) pendingManagerLinks.push({ userId, managerEmail });

      // Parse can_teach and wants_to_learn columns (comma-separated)
      const canTeach = (row.can_teach || '').split(',').map(s => s.trim()).filter(Boolean);
      const wantsToLearn = (row.wants_to_learn || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const skill of canTeach) insertSkill.run(userId, skill, 'can_teach');
      for (const skill of wantsToLearn) insertSkill.run(userId, skill, 'wants_to_learn');
    }
  });

  importMany();

  // Second pass: resolve manager_email → manager_id now that everyone is in the DB
  if (pendingManagerLinks.length > 0) {
    const findByEmail = db.prepare('SELECT id FROM users WHERE email = ?');
    const setMgr = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
    const linkAll = db.transaction(() => {
      for (const { userId, managerEmail } of pendingManagerLinks) {
        const mgr = findByEmail.get(managerEmail);
        if (mgr) setMgr.run(mgr.id, userId);
      }
    });
    linkAll();
  }

  // Recompute all matches after import
  let matchCount = 0;
  try {
    computeAllMatches();
    matchCount = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;
  } catch (e) {
    console.error('Match computation error after upload:', e);
  }

  auditLog(req, 'admin.upload', 'csv', null, {
    rows: normalized.length,
    imported,
    skipped: normalized.length - imported,
  });

  res.json({
    imported,
    total: normalized.length,
    skipped: normalized.length - imported,
    matchesGenerated: matchCount,
    defaultPassword: DEFAULT_PASSWORD,
    message: `${imported} users imported. ${matchCount} matches generated. Default password: ${DEFAULT_PASSWORD}`
  });
});

// POST /api/admin/rematch
router.post('/rematch', authMiddleware, adminOnly, (req, res) => {
  computeAllMatches();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;
  auditLog(req, 'admin.rematch', null, null, { match_count: count });
  res.json({ matchesGenerated: count, message: `Matching complete. ${count} match pairs stored.` });
});

// POST /api/admin/broadcast-checkin
// In production this would be triggered by a cron 1-2x/week; for the MVP demo
// flow an admin can fire it manually to make every employee's "weekly check-in"
// reminder land immediately, both as an in-app banner and (with permission) a
// desktop notification.
router.post('/broadcast-checkin', authMiddleware, adminOnly, (req, res) => {
  const result = db.prepare(
    "UPDATE users SET pending_checkin = 1 WHERE is_admin = 0"
  ).run();
  auditLog(req, 'admin.broadcast_checkin', null, null, { recipients: result.changes });
  res.json({
    recipients: result.changes,
    sentAt: new Date().toISOString(),
    message: `Check-in nudge queued for ${result.changes} employees.`
  });
});

// GET /api/admin/audit?limit=100
// Returns recent audit-log events. Sensitive content is never recorded
// (reflection text, profile field values), only actions and counts.
router.get('/audit', authMiddleware, adminOnly, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.ip, a.created_at,
      u.email as actor_email, u.name as actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC
    LIMIT ?
  `).all(limit);
  res.json({
    entries: rows.map(r => ({
      id: r.id,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      metadata: JSON.parse(r.metadata || '{}'),
      ip: r.ip,
      created_at: r.created_at,
      actor: r.actor_email ? { email: r.actor_email, name: r.actor_name } : null,
    })),
    total: db.prepare('SELECT COUNT(*) as cnt FROM audit_logs').get().cnt,
  });
});

// GET /api/admin/template  — downloadable CSV template
router.get('/template', authMiddleware, adminOnly, (req, res) => {
  const csv =
    'name,email,department,current_role,tenure_years,location,manager_email,can_teach,wants_to_learn\n' +
    'Jane Smith,jane.smith@company.com,Engineering,Software Engineer,3,London,sarah.lead@company.com,"React,TypeScript","system design,leadership"\n' +
    'John Doe,john.doe@company.com,Finance,Financial Analyst,1,New York,frank.wu@company.com,"Excel","financial modeling,Python"\n';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ment-import-template.csv"');
  res.send(csv);
});

module.exports = router;
