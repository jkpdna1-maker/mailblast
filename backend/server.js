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

  app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
  }));

  const authRoutes = require('./routes/auth');
  const campaignRoutes = require('./routes/campaigns');

  app.use('/auth', authRoutes);
  app.use('/campaigns', campaignRoutes);
  app.use('/track', campaignRoutes);
  app.get('/health', (req, res) => res.json({ ok: true }));

  startScheduler();

  app.listen(PORT, () => {
    console.log(`MailBlast backend running on http://localhost:${PORT}`);
  });
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });
