const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');
const { auditLogAs } = require('../utils/auditLog');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
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

  const directReports = db.prepare(
    'SELECT COUNT(*) as cnt FROM users WHERE manager_id = ? AND is_admin = 0'
  ).get(user.id).cnt;

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      department: user.department,
      seniority: user.seniority,
      current_role: user.current_role,
      bio: user.bio,
      onboarding_complete: user.onboarding_complete,
      is_admin: user.is_admin,
      direct_reports: directReports,
    }
  });
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

  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      department: user.department,
      seniority: user.seniority,
      current_role: user.current_role,
      bio: user.bio,
      onboarding_complete: user.onboarding_complete,
      is_admin: user.is_admin
    }
  });
});

module.exports = router;
