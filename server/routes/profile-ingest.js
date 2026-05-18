const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { auditLog } = require('../utils/auditLog');
const { extractTextFromBuffer, extractStructuredProfile } = require('../utils/profileExtractor');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(docx|pdf|txt)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only .docx, .pdf, and .txt files are allowed'), ok);
  },
});

router.post('/ingest', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const kind = ['performance_review', 'cv', 'manual_text'].includes(req.body.kind)
    ? req.body.kind
    : 'performance_review';

  try {
    const rawText = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    if (!rawText || rawText.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract enough text from the file' });
    }

    const { proposed, classifier_source } = await extractStructuredProfile(rawText);

    const result = db.prepare(`
      INSERT INTO profile_drafts (user_id, source, raw_text, proposed_json, classifier_source)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      kind,
      rawText.slice(0, 50000),
      JSON.stringify(proposed),
      classifier_source
    );

    auditLog(req, 'profile.ingest', 'profile_draft', result.lastInsertRowid, {
      kind,
      classifier_source,
    });

    res.json({
      draft_id: result.lastInsertRowid,
      proposed,
      classifier_source,
    });
  } catch (e) {
    console.error('profile ingest error:', e);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

router.post('/ingest/:draftId/accept', (req, res) => {
  const draftId = parseInt(req.params.draftId, 10);
  const draft = db.prepare('SELECT * FROM profile_drafts WHERE id = ? AND user_id = ?')
    .get(draftId, req.user.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  const accepted = req.body.accepted_json || req.body.accepted;
  if (!accepted) return res.status(400).json({ error: 'accepted_json required' });

  db.prepare(`
    UPDATE profile_drafts SET accepted_json = ?, accepted_at = datetime('now') WHERE id = ?
  `).run(JSON.stringify(accepted), draftId);

  auditLog(req, 'profile.draft_accepted', 'profile_draft', draftId);
  res.json({ ok: true });
});

module.exports = router;
