const db = require('../db/database');

const insertStmt = db.prepare(`
  INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Log an audit event. Sensitive content (reflection text, profile details) is
// deliberately NOT recorded — we only capture *who*, *what action*, *which
// target*, and minimal metadata (counts, status transitions).
//
// Usage:
//   auditLog(req, 'session.accept', 'session', sessionId);
//   auditLog(req, 'admin.broadcast_checkin', null, null, { recipients: 300 });
function auditLog(req, action, targetType = '', targetId = null, metadata = {}) {
  try {
    const actorId = req?.user?.id || null;
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || '';
    insertStmt.run(
      actorId,
      action,
      targetType || '',
      targetId || null,
      JSON.stringify(metadata || {}),
      String(ip).slice(0, 64)
    );
  } catch (e) {
    // Never let logging block a request
    console.error('[audit] failed to log:', e.message);
  }
}

// Log a no-actor event (e.g., login, where req.user isn't set yet)
function auditLogAs(actorId, action, targetType, targetId, metadata, ip) {
  try {
    insertStmt.run(
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

module.exports = { auditLog, auditLogAs };
