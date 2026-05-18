const bcrypt = require('bcryptjs');
const { setupTestDb, truncateAll, teardownTestDb } = require('./helpers');

let dbPath;
let db;
let enrichSession;

beforeAll(() => {
  ({ dbPath, db } = setupTestDb());
  enrichSession = require('../routes/sessions').enrichSession;
});
afterAll(() => teardownTestDb(dbPath));
beforeEach(() => {
  truncateAll(db);
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, department) VALUES (1, 'm@t.io', ?, 'Mentor', 'Eng')`).run(hash);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, department) VALUES (2, 'e@t.io', ?, 'Mentee', 'Fin')`).run(hash);
  db.prepare(`
    INSERT INTO sessions (id, mentor_id, mentee_id, title, status, reflection, mentor_reflection, mentee_rating, mentor_rating, pre_session_question)
    VALUES (1, 1, 2, 'T', 'scheduled', 'secret mentee', 'secret mentor', 5, 4, 'private q')
  `).run();
});

describe('enrichSession privacy', () => {
  test('mentee sees own reflection + rating, never mentor side or pre_session_question', () => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = 1').get();
    const out = enrichSession(session, 2);
    expect(out.reflection).toBe('secret mentee');
    expect(out.mentor_reflection).toBeUndefined();
    expect(out.mentee_rating).toBe(5);
    expect(out.mentor_rating).toBeUndefined();
    expect(out.pre_session_question).toBeUndefined();
  });

  test('mentor sees own reflection, rating, and pre_session_question; never mentee side', () => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = 1').get();
    const out = enrichSession(session, 1);
    expect(out.mentor_reflection).toBe('secret mentor');
    expect(out.reflection).toBeUndefined();
    expect(out.mentor_rating).toBe(4);
    expect(out.mentee_rating).toBeUndefined();
    expect(out.pre_session_question).toBe('private q');
  });
});
