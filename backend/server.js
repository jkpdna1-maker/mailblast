require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { initDb } = require('./db/database');
const { startScheduler } = require('./services/scheduler');

const PORT = process.env.PORT || 3001;

async function start() {
  await initDb();
  console.log('[db] Database ready');

  const app = express();

  const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'https://enchanting-muffin-338578.netlify.app'
].filter(Boolean);
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.set('trust proxy', 1);
  const SQLiteStore = require('connect-sqlite3')(session);
  app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: './' }),
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    const cookieSession = require('cookie-session');
  app.use(cookieSession({
    name: 'session',
    secret: process.env.SESSION_SECRET || 'dev_secret',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: true,
    sameSite: 'none',
    httpOnly: true
  }));

  const authRoutes = require('./routes/auth');
  const campaignRoutes = require('./routes/campaigns');

  app.use('/auth', authRoutes);
  app.use('/campaigns', campaignRoutes);
  app.use('/track', campaignRoutes);
  app.get('/health', (req, res) => res.json({ ok: true }));
  
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });

  startScheduler();

  app.listen(PORT, () => {
    console.log(`MailBlast backend running on http://localhost:${PORT}`);
  });
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });
