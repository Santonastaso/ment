const express = require('express');
const { getMatchesForUser, countMatchesForUser } = require('../utils/matching');

const router = express.Router();

// GET /api/matches?limit=3&offset=0&role=mentor
// No limit returns all stored matches (sorted by score desc, dismissed filtered out).
// role=mentor restricts to candidates who lean toward being a mentor for the
// viewer (they teach what you want to learn, or are senior to you, etc.).
router.get('/', (req, res) => {
  const limit = req.query.limit ? Math.max(0, parseInt(req.query.limit)) : undefined;
  const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset)) : 0;
  const role = req.query.role === 'mentor' ? 'mentor' : null;
  const matches = getMatchesForUser(req.user.id, { limit, offset, role });
  const total = countMatchesForUser(req.user.id, { role });
  res.json({ matches, total });
});

module.exports = router;
