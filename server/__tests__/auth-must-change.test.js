const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const { setupTestDb, truncateAll, teardownTestDb } = require('./helpers');

let dbPath;
let db;
let app;

beforeAll(() => {
  ({ dbPath, db } = setupTestDb());
  const { authMiddleware, requirePasswordOk } = require('../middleware/auth');
  const users = require('../routes/users');
  app = express();
  app.use(express.json());
  app.use('/api/users', authMiddleware, requirePasswordOk, users);
});
afterAll(() => teardownTestDb(dbPath));

function setupUser(must) {
  truncateAll(db);
  const hash = bcrypt.hashSync('temppass1', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, department, must_change_password) VALUES (1, 'u@t.io', ?, 'U', 'Eng', ?)`).run(hash, must);
  return jwt.sign({ id: 1, email: 'u@t.io', is_admin: 0 }, process.env.JWT_SECRET);
}

describe('must_change_password gate', () => {
  test('PUT /me blocked when flag is set', async () => {
    const token = setupUser(1);
    const res = await request(app).put('/api/users/me').set('Authorization', `Bearer ${token}`).send({ bio: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('must_change_password');
  });

  test('GET /me allowed even when flag is set', async () => {
    const token = setupUser(1);
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('u@t.io');
  });

  test('PUT /me allowed when flag is cleared', async () => {
    const token = setupUser(0);
    const res = await request(app).put('/api/users/me').set('Authorization', `Bearer ${token}`).send({ bio: 'x' });
    expect(res.status).toBe(200);
  });

  test('deactivated user is rejected', async () => {
    const token = setupUser(0);
    db.prepare("UPDATE users SET deactivated_at = datetime('now') WHERE id = 1").run();
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Account deactivated');
  });
});
