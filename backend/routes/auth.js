const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getAuthUrl, getTokensFromCode, getUserInfo } = require('../services/gmail');
const { registerTokens } = require('../services/scheduler');
const { pool } = require('../db/database');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'mailblast_jwt_secret';

const ALLOWED_EMAILS = [
  'kjnadp@gmail.com',
  'napdjk@gmail.com',
  'jkpdna1@gmail.com',
  'guruvujk@gmail.com',
  'okjpna@gmail.com'
];

const authMiddleware = (req, res, next) => {
  if (req.session && req.session.user) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      req.session.user = decoded;
      req.session.passwordVerified = req.session.passwordVerified || false;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  next();
};

router.use(authMiddleware);

// Step 1: Redirect to Google
router.get('/google', (req, res) => {
  const { redirectUri } = req.query;
  if (redirectUri && redirectUri.startsWith('com.jkraowin')) {
    // Mobile app flow
    const cleanCallbackUri = 'https://mailblast-mobile-backend.onrender.com/auth/google/mobile-callback';
    const url = getAuthUrl(cleanCallbackUri, redirectUri);
    res.redirect(url);
  } else {
    // Web browser flow
    const url = getAuthUrl(process.env.GOOGLE_REDIRECT_URI);
    res.redirect(url);
  }
});

// Step 2: Google callback (web)
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('[callback] code:', !!code, 'error:', error, 'query:', JSON.stringify(req.query));
  console.log('[callback] REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI);
  console.log('[callback] FRONTEND_URL:', process.env.FRONTEND_URL);
  if (error || !code) return res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  try {
    const tokens = await getTokensFromCode(code);
    const user = await getUserInfo(tokens);
    if (!ALLOWED_EMAILS.includes(user.email)) {
      return res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
    }
    const { rows } = await pool.query('SELECT mb_locked FROM users WHERE email=$1', [user.email]);
    if (rows[0] && rows[0].mb_locked) {
      return res.redirect(`${process.env.FRONTEND_URL}?auth=locked`);
    }
    req.session.tokens = tokens;
    req.session.user = { email: user.email, name: user.name, picture: user.picture };
    req.session.passwordVerified = false;
    await registerTokens(user.email, tokens);
    await pool.query(`
      INSERT INTO users (email, name, picture) VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name=$2, picture=$3
    `, [user.email, user.name, user.picture]);
    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect(`${process.env.FRONTEND_URL}?auth=success&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name)}&picture=${encodeURIComponent(user.picture)}`);
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  }
});

// Mobile: Google OAuth callback - returns JWT via redirect
router.get('/google/mobile-callback', async (req, res) => {
  const { code, error, state } = req.query;
  const appRedirect = state || 'com.jkraowin.mailblastapp://';
  const cleanCallbackUri = 'https://mailblast-mobile-backend.onrender.com/auth/google/mobile-callback';
  if (error || !code) return res.redirect(`${appRedirect}?auth=error`);
  try {
    const tokens = await getTokensFromCode(code, cleanCallbackUri);
    const user = await getUserInfo(tokens);
    if (!ALLOWED_EMAILS.includes(user.email)) {
      return res.redirect(`${appRedirect}?auth=error`);
    }
    await registerTokens(user.email, tokens);
    await pool.query(`
      INSERT INTO users (email, name, picture) VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name=$2, picture=$3
    `, [user.email, user.name, user.picture]);
    const token = jwt.sign(
      { email: user.email, name: user.name, picture: user.picture },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const userEncoded = encodeURIComponent(JSON.stringify({ email: user.email, name: user.name, picture: user.picture }));
    res.redirect(`${appRedirect}?token=${token}&user=${userEncoded}`);
  } catch (err) {
    console.error('Mobile callback error:', err);
    res.redirect(`${appRedirect}?auth=error`);
  }
});

// Mobile: verify Google access token and return JWT
router.post('/google/mobile', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'No access token' });
  try {
    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const user = await googleRes.json();
    if (!user.email) return res.status(401).json({ error: 'Invalid Google token' });
    if (!ALLOWED_EMAILS.includes(user.email)) {
      return res.status(403).json({ error: 'Email not allowed' });
    }
    const { rows } = await pool.query('SELECT mb_locked FROM users WHERE email=$1', [user.email]);
    if (rows[0] && rows[0].mb_locked) {
      return res.status(403).json({ error: 'Account locked. Contact admin.' });
    }
    await pool.query(`
      INSERT INTO users (email, name, picture) VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name=$2, picture=$3
    `, [user.email, user.name, user.picture]);
    await registerTokens(user.email, { access_token });
    const token = jwt.sign(
      { email: user.email, name: user.name, picture: user.picture },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { email: user.email, name: user.name, picture: user.picture } });
  } catch (err) {
    console.error('Mobile auth error:', err);
    res.status(500).json({ error: 'Auth failed' });
  }
});

// Check password status
router.get('/password-status', async (req, res) => {
  const currentUser = req.session.user || req.user;
if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  const { rows } = await pool.query('SELECT mb_password, mb_locked FROM users WHERE email=$1', [currentUser.email]);
  if (!rows[0]) return res.json({ hasPassword: false, locked: false });
  res.json({
    hasPassword: !!rows[0].mb_password,
    locked: !!rows[0].mb_locked,
    passwordVerified: !!req.session.passwordVerified
  });
});

// Set password (first time)
router.post('/set-password', async (req, res) => {
  const currentUser = req.session.user || req.user;
if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const { rows } = await pool.query('SELECT mb_password FROM users WHERE email=$1', [currentUser.email]);
  if (rows[0] && rows[0].mb_password) {
    return res.status(400).json({ error: 'Password already set' });
  }
  const hashed = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET mb_password=$1 WHERE email=$2', [hashed, currentUser.email]);
  req.session.passwordVerified = true;
  res.json({ ok: true });
});

// Verify password
router.post('/verify-password', async (req, res) => {
  const currentUser = req.session.user || req.user;
if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  const { password } = req.body;
  const { rows } = await pool.query('SELECT mb_password, mb_failed_attempts, mb_locked FROM users WHERE email=$1', [currentUser.email]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  if (rows[0].mb_locked) return res.status(403).json({ error: 'Account locked. Contact admin.' });
  const match = await bcrypt.compare(password, rows[0].mb_password);
  if (match) {
    await pool.query('UPDATE users SET mb_failed_attempts=0 WHERE email=$1', [currentUser.email]);
    req.session.passwordVerified = true;
    return res.json({ ok: true });
  }
  const attempts = (rows[0].mb_failed_attempts || 0) + 1;
  if (attempts >= 3) {
    await pool.query('UPDATE users SET mb_failed_attempts=$1, mb_locked=1, mb_locked_at=$2 WHERE email=$3',
      [attempts, new Date().toISOString(), currentUser.email]);
    req.session.destroy();
    return res.status(403).json({ error: 'Account locked after 3 failed attempts. Contact admin.' });
  }
  await pool.query('UPDATE users SET mb_failed_attempts=$1 WHERE email=$2', [attempts, currentUser.email]);
  return res.status(401).json({ error: `Wrong password. ${3 - attempts} attempt(s) remaining.` });
});

// Get current user
router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user, passwordVerified: !!req.session.passwordVerified });
});


// Change password
router.post('/change-password', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const { password } = req.body;
  if (!password || password.length < 6 || password.length > 16) {
    return res.status(400).json({ error: 'Password must be 6-16 characters' });
  }
  const hashed = await bcrypt.hash(password, 10);
  await pool.query(
    'UPDATE users SET mb_password=$1, mb_failed_attempts=0 WHERE email=$2',
    [hashed, req.session.user.email]
  );
  res.json({ ok: true });
});
// Logout
router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

module.exports = router;
