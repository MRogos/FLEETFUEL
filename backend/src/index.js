require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const { initDB, pool } = require('./db/init');
const authRouter = require('./routes/auth');
const vehiclesRouter = require('./routes/vehicles');
const refuelsRouter = require('./routes/refuels');
const statsRouter = require('./routes/stats');
const scanRouter = require('./routes/scan');
const requireAuth = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'fleetfuel-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax',
  }
}));

app.use('/api/auth', authRouter);
app.use(express.static(path.join(__dirname, '../../frontend')));
app.use(requireAuth);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/refuels', refuelsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/scan', scanRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`🚀 FleetFuel running on port ${PORT}`);
  });
})();
