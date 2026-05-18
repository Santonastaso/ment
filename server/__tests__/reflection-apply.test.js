const bcrypt = require('bcryptjs');
const { setupTestDb, truncateAll, teardownTestDb } = require('./helpers');

let dbPath;
let db;

beforeAll(() => { ({ dbPath, db } = setupTestDb()); });
afterAll(() => teardownTestDb(dbPath));
beforeEach(() => {
  truncateAll(db);
  const hash = bcrypt.hashSync('x', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, department) VALUES (1, 'u@t.io', ?, 'U', 'Eng')`).run(hash);
  db.prepare(`INSERT INTO skills (user_id, skill, type) VALUES (1, 'React', 'can_teach')`).run();
});

describe('reflection apply dedup', () => {
  test('skips duplicate skills case-insensitively', () => {
    const existing = db.prepare('SELECT skill, type FROM skills WHERE user_id = 1').all();
    const existsKey = new Set(existing.map(s => `${s.type}::${s.skill.toLowerCase().trim()}`));
    const insert = db.prepare('INSERT INTO skills (user_id, skill, type) VALUES (?, ?, ?)');
    let added = 0;
    for (const raw of ['react', 'TypeScript']) {
      const skill = raw.trim();
      const key = `can_teach::${skill.toLowerCase()}`;
      if (!existsKey.has(key)) {
        insert.run(1, skill, 'can_teach');
        existsKey.add(key);
        added++;
      }
    }
    expect(added).toBe(1);
    const count = db.prepare("SELECT COUNT(*) as c FROM skills WHERE user_id = 1 AND type = 'can_teach'").get().c;
    expect(count).toBe(2);
  });
});
