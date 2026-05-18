const express = require('express');
const db = require('../db/database');

const router = express.Router();

// POST /api/connections — upsert. If the connection already exists, update its
// status; otherwise insert. Lets the client mark "not interested" in one call
// instead of POST-then-PUT (which had a bug where the PUT used the wrong id).
router.post('/', (req, res) => {
  const { addressee_id, status: requestedStatus } = req.body;
  if (!addressee_id) return res.status(400).json({ error: 'addressee_id required' });
  if (addressee_id === req.user.id) return res.status(400).json({ error: 'Cannot connect with yourself' });

  const allowed = ['pending', 'declined', 'accepted'];
  const status = allowed.includes(requestedStatus) ? requestedStatus : 'pending';

  const existing = db.prepare(
    'SELECT id FROM connections WHERE requester_id = ? AND addressee_id = ?'
  ).get(req.user.id, addressee_id);

  if (existing) {
    db.prepare('UPDATE connections SET status = ? WHERE id = ?').run(status, existing.id);
    return res.json({ id: existing.id, status, updated: true });
  }

  const result = db.prepare(
    'INSERT INTO connections (requester_id, addressee_id, status) VALUES (?, ?, ?)'
  ).run(req.user.id, addressee_id, status);
  res.status(201).json({ id: result.lastInsertRowid, status });
});

// PUT /api/connections/:id
router.put('/:id', (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted or declined' });
  }

  const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(parseInt(req.params.id));
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  // Only the addressee can accept/decline, or the requester can decline (not interested)
  if (conn.addressee_id !== req.user.id && conn.requester_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  db.prepare('UPDATE connections SET status = ? WHERE id = ?').run(status, conn.id);
  res.json({ id: conn.id, status });
});

// GET /api/connections
router.get('/', (req, res) => {
  const connections = db.prepare(`
    SELECT c.*,
      r.name as requester_name, r.department as requester_dept,
      a.name as addressee_name, a.department as addressee_dept
    FROM connections c
    JOIN users r ON r.id = c.requester_id
    JOIN users a ON a.id = c.addressee_id
    WHERE c.requester_id = ? OR c.addressee_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id, req.user.id);
  res.json(connections);
});

module.exports = router;
