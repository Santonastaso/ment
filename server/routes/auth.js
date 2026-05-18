const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { auditLogAs } = require('../utils/auditLog');

const router = express.Router();

function userPayload(user) {
  const directReports = db.prepare(
    'SELECT COUNT(*) as cnt FROM users WHERE manager_id = ? AND is_admin = 0'
  ).get(user.id).cnt;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    department: user.department,
    seniority: user.seniority,
    current_role: user.current_role,
    bio: user.bio,
    onboarding_complete: user.onboarding_complete,
    is_admin: user.is_admin,
    must_change_password: user.must_change_password || 0,
    direct_reports: directReports,
  };
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.deactivated_at) {
    return res.status(403).json({ error: 'Account deactivated' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    auditLogAs(user.id, 'auth.login_failed', 'user', user.id, {}, req.ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  auditLogAs(user.id, 'auth.login', 'user', user.id, { is_admin: user.is_admin }, req.ip);

  res.json({ token, user: userPayload(user) });
});

router.post('/register', (req, res) => {
  const { email, password, name, department, seniority, current_role } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (email, password_hash, name, department, seniority, current_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    email.toLowerCase().trim(),
    hash,
    name.trim(),
    department || '',
    seniority || 'junior',
    current_role || ''
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token, user: userPayload(user) });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hash, user.id);

  auditLogAs(user.id, 'auth.password_changed', 'user', user.id, {}, req.ip);

  res.json({ ok: true, user: userPayload({ ...user, must_change_password: 0 }) });
});

module.exports = router;
