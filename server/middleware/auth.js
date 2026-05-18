const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET env var required (>=32 chars). Refusing to boot.');
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Endpoints allowed while a user has must_change_password=1.
// Identified by (mount path, route path) tuples so the lookup is explicit.
const PASSWORD_BYPASS = [
  { mount: '/api/users', method: 'GET', path: '/me' },
];

/** Block API calls until the user has rotated a temp password or has been deactivated. */
function requirePasswordOk(req, res, next) {
  const row = db.prepare(
    'SELECT must_change_password, deactivated_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!row) return res.status(401).json({ error: 'User not found' });
  if (row.deactivated_at) return res.status(403).json({ error: 'Account deactivated' });

  if (row.must_change_password) {
    const allowed = PASSWORD_BYPASS.some(
      r => r.method === req.method && r.mount === req.baseUrl && r.path === req.path
    );
    if (!allowed) return res.status(403).json({ error: 'must_change_password' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly, requirePasswordOk, JWT_SECRET };
