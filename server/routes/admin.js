const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { computeAllMatches } = require('../utils/matching');
const { auditLog } = require('../utils/auditLog');
const { generateTempPassword } = require('../utils/password');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// auth + adminOnly are applied at mount in server/index.js.

const VALID_SENIORITIES = ['junior', 'mid', 'senior', 'lead'];
const IMPORT_MODES = ['insert', 'update', 'upsert'];

// ---------- helpers ----------

function csvEscape(v) {
  const s = String(v ?? '');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseSkillList(cell) {
  return (cell || '').split(',').map(s => s.trim()).filter(Boolean);
}

function normalizeCsvRows(rows) {
  return rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k.trim().toLowerCase().replace(/\s+/g, '_'),
        String(v).trim(),
      ])
    )
  );
}

function buildImportFields(row) {
  return {
    email: (row.email || '').toLowerCase().trim(),
    name: row.name || row.full_name || '',
    department: row.department || '',
    current_role: row.current_role || row.role || '',
    seniority: VALID_SENIORITIES.includes(row.seniority) ? row.seniority : 'junior',
    tenure_years: parseInt(row.tenure_years) || 0,
    location: (row.location || '').trim(),
    manager_email: (row.manager_email || row.manager || '').toLowerCase().trim(),
    can_teach: parseSkillList(row.can_teach),
    wants_to_learn: parseSkillList(row.wants_to_learn),
  };
}

function replaceSkills(userId, canTeach, wantsToLearn) {
  if (!canTeach.length && !wantsToLearn.length) return;
  db.prepare('DELETE FROM skills WHERE user_id = ?').run(userId);
  const insertSkill = db.prepare('INSERT INTO skills (user_id, skill, type) VALUES (?, ?, ?)');
  for (const skill of canTeach) insertSkill.run(userId, skill, 'can_teach');
  for (const skill of wantsToLearn) insertSkill.run(userId, skill, 'wants_to_learn');
}

function applyManagerLinks(links) {
  if (!links.length) return;
  const findByEmail = db.prepare('SELECT id FROM users WHERE email = ?');
  const setMgr = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const { userId, managerEmail } of links) {
      const mgr = findByEmail.get(managerEmail);
      if (mgr) setMgr.run(mgr.id, userId);
    }
  })();
}

// ---------- routes ----------

router.get('/stats', (req, res) => {
  const single = (sql) => db.prepare(sql).get().cnt;
  const totalUsers = single(
    "SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0 AND deactivated_at IS NULL"
  );
  const onboarded = single(
    "SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0 AND onboarding_complete = 1 AND deactivated_at IS NULL"
  );

  res.json({
    totalUsers,
    onboarded,
    onboardingRate: totalUsers > 0 ? Math.round((onboarded / totalUsers) * 100) : 0,
    totalMatches: single("SELECT COUNT(*) as cnt FROM match_scores"),
    sessionsByStatus: db.prepare(
      "SELECT status, COUNT(*) as cnt FROM sessions GROUP BY status"
    ).all(),
    topMentors: db.prepare(`
      SELECT u.id, u.name, u.department, u.seniority, COUNT(s.id) as session_count
      FROM users u
      JOIN sessions s ON s.mentor_id = u.id AND s.status = 'completed'
      WHERE u.deactivated_at IS NULL
      GROUP BY u.id
      ORDER BY session_count DESC
      LIMIT 5
    `).all(),
    deptActivity: db.prepare(`
      SELECT u.department, COUNT(DISTINCT s.id) as session_count
      FROM users u
      LEFT JOIN sessions s ON (s.mentor_id = u.id OR s.mentee_id = u.id) AND s.status = 'completed'
      WHERE u.is_admin = 0 AND u.deactivated_at IS NULL
      GROUP BY u.department
      ORDER BY session_count ASC
    `).all(),
  });
});

router.get('/users', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.department, u.current_role, u.onboarding_complete,
      u.deactivated_at, u.must_change_password,
      m.email as manager_email
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.is_admin = 0
    ORDER BY u.name
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0').get().cnt;
  res.json({ users, total });
});

router.get('/users/:id', (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.email, u.name, u.department, u.current_role, u.onboarding_complete,
      u.deactivated_at, u.must_change_password, u.manager_id,
      m.email as manager_email, m.name as manager_name
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = ? AND u.is_admin = 0
  `).get(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.put('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_admin = 0').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { manager_email, deactivate } = req.body;

  if (manager_email !== undefined) {
    const email = (manager_email || '').toLowerCase().trim();
    if (!email) {
      db.prepare('UPDATE users SET manager_id = NULL WHERE id = ?').run(id);
    } else {
      const mgr = db.prepare(
        'SELECT id FROM users WHERE email = ? AND deactivated_at IS NULL'
      ).get(email);
      if (!mgr) return res.status(400).json({ error: 'Manager email not found' });
      if (mgr.id === id) return res.status(400).json({ error: 'User cannot be their own manager' });
      db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(mgr.id, id);
    }
    auditLog(req, 'admin.user_manager_updated', 'user', id, { manager_email: email || null });
  }

  if (deactivate === true) {
    db.prepare("UPDATE users SET deactivated_at = datetime('now') WHERE id = ?").run(id);
    auditLog(req, 'admin.user_deactivated', 'user', id);
  }

  const updated = db.prepare(`
    SELECT u.id, u.email, u.name, u.department, u.deactivated_at,
      m.email as manager_email
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = ?
  `).get(id);
  res.json({ user: updated });
});

router.post('/users/:id/reset-password', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id, email FROM users WHERE id = ? AND is_admin = 0').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = generateTempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(bcrypt.hashSync(tempPassword, 10), id);
  auditLog(req, 'admin.password_reset', 'user', id, { email: user.email });

  res.json({
    email: user.email,
    tempPassword,
    message: 'Share this password once with the user. They must change it on next login.',
  });
});

// POST /api/admin/upload?mode=insert|update|upsert
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const mode = IMPORT_MODES.includes(req.query.mode) ? req.query.mode : 'insert';

  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch {
    return res.status(400).json({ error: 'Could not parse file. Ensure it is a valid CSV or XLSX.' });
  }
  if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });

  const normalized = normalizeCsvRows(rows);
  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);

  const insertUser = db.prepare(`
    INSERT INTO users
      (email, password_hash, name, department, seniority, current_role, tenure_years, location,
       onboarding_complete, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `);
  const updateUserByEmail = db.prepare(`
    UPDATE users SET department = ?, seniority = ?, current_role = ?, tenure_years = ?, location = ?
    WHERE email = ?
  `);
  const findUserByEmail = db.prepare('SELECT id FROM users WHERE email = ?');

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const pendingManagerLinks = [];

  db.transaction(() => {
    for (const row of normalized) {
      const f = buildImportFields(row);
      if (!f.email || !f.name) { skipped++; continue; }

      const existing = findUserByEmail.get(f.email);

      // Pick the action: skip / update / insert.
      let userId;
      if (existing) {
        if (mode === 'insert') { skipped++; continue; }
        updateUserByEmail.run(f.department, f.seniority, f.current_role, f.tenure_years, f.location, f.email);
        userId = existing.id;
        updated++;
      } else {
        if (mode === 'update') { skipped++; continue; }
        const result = insertUser.run(
          f.email, passwordHash, f.name, f.department, f.seniority,
          f.current_role, f.tenure_years, f.location
        );
        userId = result.lastInsertRowid;
        imported++;
      }

      if (f.manager_email) pendingManagerLinks.push({ userId, managerEmail: f.manager_email });
      if (f.can_teach.length || f.wants_to_learn.length) {
        replaceSkills(userId, f.can_teach, f.wants_to_learn);
      }
    }
  })();

  applyManagerLinks(pendingManagerLinks);

  let matchCount = 0;
  try {
    computeAllMatches();
    matchCount = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;
  } catch (e) {
    console.error('Match computation error after upload:', e);
  }

  auditLog(req, 'admin.upload', 'csv', null, {
    rows: normalized.length, imported, updated, skipped, mode,
  });

  res.json({
    imported, updated, skipped,
    total: normalized.length,
    matchesGenerated: matchCount,
    tempPassword,
    message: imported > 0
      ? `${imported} imported${updated ? `, ${updated} updated` : ''}. Temp password for new users: ${tempPassword}`
      : `${updated} updated, ${skipped} skipped.`,
  });
});

router.post('/rematch', (req, res) => {
  computeAllMatches();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM match_scores').get().cnt;
  auditLog(req, 'admin.rematch', null, null, { match_count: count });
  res.json({ matchesGenerated: count, message: `Matching complete. ${count} match pairs stored.` });
});

router.post('/broadcast-checkin', (req, res) => {
  const result = db.prepare(
    "UPDATE users SET pending_checkin = 1 WHERE is_admin = 0 AND deactivated_at IS NULL"
  ).run();
  auditLog(req, 'admin.broadcast_checkin', null, null, { recipients: result.changes });
  res.json({
    recipients: result.changes,
    sentAt: new Date().toISOString(),
    message: `Check-in nudge queued for ${result.changes} employees.`,
  });
});

router.get('/audit', (req, res) => {
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
    total: db.prepare('SELECT COUNT(*) as cnt FROM audit_logs').get().cnt,
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
  });
});

router.get('/audit/export', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.created_at, u.email as actor_email, a.action, a.target_type, a.target_id, a.ip, a.metadata
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC
  `).all();

  const header = 'id,created_at,actor_email,action,target_type,target_id,ip,metadata_json\n';
  const body = rows.map(r => [
    r.id, r.created_at, r.actor_email, r.action,
    r.target_type, r.target_id ?? '', r.ip, r.metadata,
  ].map(csvEscape).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ment-audit-export.csv"');
  res.send(header + body);
});

router.get('/template', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ment-import-template.csv"');
  res.send(
    'name,email,department,current_role,tenure_years,location,manager_email,can_teach,wants_to_learn\n' +
    'Jane Smith,jane.smith@company.com,Engineering,Software Engineer,3,London,sarah.lead@company.com,"React,TypeScript","system design,leadership"\n' +
    'John Doe,john.doe@company.com,Finance,Financial Analyst,1,New York,frank.wu@company.com,"Excel","financial modeling,Python"\n'
  );
});

module.exports = router;
