require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cors = require('cors');
const { initDb } = require('./db/database');
const { startScheduler } = require('./services/scheduler');
const path = require('path');
const PORT = process.env.PORT || 3001;

async function start() {
  await initDb();
  console.log('[db] Database ready');
  const app = express();

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://10.27.169.148:3000',
    'https://enchanting-muffin-338578.netlify.app',
    'https://jogger-manhood-resigned.ngrok-free.dev'
  ].filter(Boolean);

  app.use(cors({ origin: true, credentials: true }));
  app.use((req, res, next) => { res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.set('trust proxy', 1);

  app.use(session({
    store: new FileStore({ path: './sessions', ttl: 86400, retries: 0 }),
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  const authRoutes = require('./routes/auth');
  const campaignRoutes = require('./routes/campaigns');
  const { router: livenessRoutes, requireLiveness } = require('./routes/liveness');
  app.use('/auth', authRoutes);
  app.use('/liveness', livenessRoutes);
  app.use('/campaigns', campaignRoutes);
  app.use('/track', campaignRoutes);
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });

  startScheduler();
  app.listen(PORT, () => {
    console.log(`MailBlast backend running on http://localhost:${PORT}`);
  });
}
start().catch(err => { console.error('Startup error:', err); process.exit(1); });