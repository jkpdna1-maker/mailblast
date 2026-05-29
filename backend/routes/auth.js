const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getAuthUrl, getTokensFromCode, getUserInfo } = require('../services/gmail');
const { registerTokens } = require('../services/scheduler');
const { pool } = require('../db/database');
require('dotenv').config();

const ALLOWED_EMAILS = [
  'kjnadp@gmail.com',
  'napdijk@gmail.com',
  'jkpdna1@gmail.com',
  'gururaj@gmail.com',
  'okijpna@gmail.com'
];

// Step 1: Redirect to Google
router.get('/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// Step 2: Google callback
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  try {
    const tokens = await getTokensFromCode(code);
    const user = await getUserInfo(tokens);

    if (!ALLOWED_EMAILS.includes(user.email)) {
      return res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
    }

    // Check if locked
    const { rows } = await pool.query('SELECT mb_locked FROM users WHERE email=$1', [user.email]);
    if (rows[0] && rows[0].mb_locked) {
      return res.redirect(`${process.env.FRONTEND_URL}?auth=locked`);
    }

    req.session.tokens = tokens;
    req.session.user = { email: user.email, name: user.name, picture: user.picture };
    req.session.passwordVerified = false;

    await registerTokens(user.email, tokens);

    // Upsert user
    await pool.query(`
      INSERT INTO users (email, name, picture) VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name=$2, picture=$3
    `, [user.email, user.name, user.picture]);

    res.redirect(`${process.env.FRONTEND_URL}?auth=success&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name)}&picture=${encodeURIComponent(user.picture)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  }
});

// Check password status
router.get('/password-status', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const { rows } = await pool.query('SELECT mb_password, mb_locked FROM users WHERE email=$1', [req.session.user.email]);
  if (!rows[0]) return res.json({ hasPassword: false, locked: false });
  res.json({
    hasPassword: !!rows[0].mb_password,
    locked: !!rows[0].mb_locked,
    passwordVerified: !!req.session.passwordVerified
  });
});

// Set password (first time)
router.post('/set-password', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const { password } = req.body;
  if (!password || password.length < 8 || password.length > 16) {
    return res.status(400).json({ error: 'Password must be 8-16 characters' });
  }
  const { rows } = await pool.query('SELECT mb_password FROM users WHERE email=$1', [req.session.user.email]);
  if (rows[0] && rows[0].mb_password) {
    return res.status(400).json({ error: 'Password already set' });
  }
  const hashed = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET mb_password=$1 WHERE email=$2', [hashed, req.session.user.email]);
  req.session.passwordVerified = true;
  res.json({ ok: true });
});

// Verify password
router.post('/verify-password', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const { password } = req.body;
  const { rows } = await pool.query('SELECT mb_password, mb_failed_attempts, mb_locked FROM users WHERE email=$1', [req.session.user.email]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  if (rows[0].mb_locked) return res.status(403).json({ error: 'Account locked. Contact admin.' });

  const match = await bcrypt.compare(password, rows[0].mb_password);
  if (match) {
    await pool.query('UPDATE users SET mb_failed_attempts=0 WHERE email=$1', [req.session.user.email]);
    req.session.passwordVerified = true;
    return res.json({ ok: true });
  }

  const attempts = (rows[0].mb_failed_attempts || 0) + 1;
  if (attempts >= 3) {
    await pool.query('UPDATE users SET mb_failed_attempts=$1, mb_locked=1, mb_locked_at=$2 WHERE email=$3',
      [attempts, new Date().toISOString(), req.session.user.email]);
    req.session.destroy();
    return res.status(403).json({ error: 'Account locked after 3 failed attempts. Contact admin.' });
  }

  await pool.query('UPDATE users SET mb_failed_attempts=$1 WHERE email=$2', [attempts, req.session.user.email]);
  return res.status(401).json({ error: `Wrong password. ${3 - attempts} attempt(s) remaining.` });
});

// Get current user
router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user, passwordVerified: !!req.session.passwordVerified });
});

// Logout
router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

module.exports = router;