const db = require('./database');

function runSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      seniority TEXT NOT NULL DEFAULT 'junior',
      current_role TEXT NOT NULL DEFAULT '',
      tenure_years INTEGER DEFAULT 0,
      location TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      shadow_role_response TEXT DEFAULT '',
      pending_checkin INTEGER DEFAULT 0,
      manager_id INTEGER REFERENCES users(id),
      onboarding_complete INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS career_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      company TEXT DEFAULT '',
      description TEXT DEFAULT '',
      start_year INTEGER,
      end_year INTEGER
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill TEXT NOT NULL,
      type TEXT NOT NULL,
      example_project TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      addressee_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(requester_id, addressee_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mentor_id INTEGER NOT NULL REFERENCES users(id),
      mentee_id INTEGER NOT NULL REFERENCES users(id),
      connection_id INTEGER REFERENCES connections(id),
      title TEXT NOT NULL,
      scheduled_at TEXT,
      duration_minutes INTEGER DEFAULT 60,
      status TEXT DEFAULT 'pending',
      pre_session_question TEXT DEFAULT '',
      reflection TEXT DEFAULT '',
      mentor_reflection TEXT DEFAULT '',
      topics TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS match_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL REFERENCES users(id),
      user_b_id INTEGER NOT NULL REFERENCES users(id),
      score INTEGER NOT NULL,
      reasons TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_a_id, user_b_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT DEFAULT '',
      target_id INTEGER,
      metadata TEXT DEFAULT '{}',
      ip TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reflection_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      support_needed TEXT DEFAULT '',
      managed_well TEXT DEFAULT '',
      extracted_gaps TEXT DEFAULT '[]',
      extracted_strengths TEXT DEFAULT '[]',
      esco_uris TEXT DEFAULT '{}',
      classifier_source TEXT DEFAULT '',
      applied INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Idempotent migrations for databases created by earlier versions.
  // SQLite throws if the column already exists; swallow that one error.
  const migrations = [
    "ALTER TABLE users ADD COLUMN tenure_years INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN shadow_role_response TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN location TEXT DEFAULT ''",
    "ALTER TABLE skills ADD COLUMN example_project TEXT DEFAULT ''",
    "ALTER TABLE career_history ADD COLUMN description TEXT DEFAULT ''",
    "ALTER TABLE reflection_logs ADD COLUMN esco_uris TEXT DEFAULT '{}'",
    "ALTER TABLE users ADD COLUMN pending_checkin INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN manager_id INTEGER",
    "ALTER TABLE sessions ADD COLUMN topics TEXT DEFAULT '[]'",
    "ALTER TABLE sessions ADD COLUMN mentor_reflection TEXT DEFAULT ''",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }
}

module.exports = { runSchema };
