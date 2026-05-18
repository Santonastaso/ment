const db = require('../db/database');

// Sensitive content (reflection text, profile details) is deliberately NOT recorded —
// we capture *who*, *what action*, *which target*, plus minimal counts/transitions.

function safeInsert(actorId, action, targetType, targetId, metadata, ip) {
  try {
    // Prepare lazily so test code that swaps DB_PATH gets a fresh statement.
    db.prepare(`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      actorId || null,
      action,
      targetType || '',
      targetId || null,
      JSON.stringify(metadata || {}),
      String(ip || '').slice(0, 64)
    );
  } catch (e) {
    console.error('[audit] failed to log:', e.message);
  }
}

function auditLog(req, action, targetType = '', targetId = null, metadata = {}) {
  const ip = req?.ip || req?.headers?.['x-forwarded-for'] || '';
  safeInsert(req?.user?.id, action, targetType, targetId, metadata, ip);
}

function auditLogAs(actorId, action, targetType, targetId, metadata, ip) {
  safeInsert(actorId, action, targetType, targetId, metadata, ip);
}

module.exports = { auditLog, auditLogAs };
