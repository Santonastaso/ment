const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { runSchema } = require('./db/schema');
const { authMiddleware, adminOnly, requirePasswordOk } = require('./middleware/auth');

runSchema();

const app = express();
app.set('trust proxy', 1);

const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(express.json());

// Public — strict rate limit on auth endpoints
app.use(
  '/api/auth',
  rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true }),
  require('./routes/auth')
);

// Authenticated routes — single middleware chain, applied once
const authedChain = [authMiddleware, requirePasswordOk];
app.use('/api/users', authedChain, require('./routes/users'));
app.use('/api/matches', authedChain, require('./routes/matches'));
app.use('/api/connections', authedChain, require('./routes/connections'));
app.use('/api/sessions', authedChain, require('./routes/sessions'));
app.use('/api/reflections', authedChain, require('./routes/reflections'));
app.use('/api/team', authedChain, require('./routes/team'));
app.use('/api/profile', authedChain, require('./routes/profile-ingest'));
app.use('/api/admin', authedChain, adminOnly, require('./routes/admin'));

// Vite build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`MENT server running on http://localhost:${PORT}`));
