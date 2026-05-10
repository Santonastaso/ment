const express = require('express');
const cors = require('cors');
const path = require('path');
const { runSchema } = require('./db/schema');

runSchema();

const app = express();

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(express.json());

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/matches',     require('./routes/matches'));
app.use('/api/connections', require('./routes/connections'));
app.use('/api/sessions',    require('./routes/sessions'));
app.use('/api/reflections', require('./routes/reflections'));
app.use('/api/team',        require('./routes/team'));
app.use('/api/admin',       require('./routes/admin'));

// Serve Vite build in production
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
app.listen(PORT, () => {
  console.log(`MENT server running on http://localhost:${PORT}`);
});

