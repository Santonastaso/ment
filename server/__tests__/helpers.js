const fs = require('fs');
const path = require('path');

// Single DB per test file (set via beforeAll). Tables are truncated between tests
// in beforeEach so cached `db` references in any module stay valid.
function setupTestDb() {
  const dbPath = path.join(__dirname, `test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = dbPath;
  const { runSchema } = require('../db/schema');
  runSchema();
  return { dbPath, db: require('../db/database') };
}

function truncateAll(db) {
  const tables = [
    'reflection_logs', 'audit_logs', 'match_scores', 'sessions',
    'connections', 'skills', 'career_history', 'profile_drafts', 'users',
  ];
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.exec('PRAGMA foreign_keys = ON;');
}

function teardownTestDb(dbPath) {
  try { require('../db/database').close(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

module.exports = { setupTestDb, truncateAll, teardownTestDb };
