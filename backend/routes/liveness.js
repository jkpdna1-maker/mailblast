// liveness.js — Biometric liveness verification routes
const express = require('express');
const router = express.Router();
const { prepare } = require('../db/database');
const crypto = require('crypto');

// Store pending challenges in memory
const challenges = new Map();

// Generate a blink/movement challenge
router.post('/challenge', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const actions = ['blink', 'turn_left', 'turn_right', 'nod'];
  const challenge = actions[Math.floor(Math.random() * actions.length)];
  const token = crypto.randomBytes(16).toString('hex');
  challenges.set(req.session.user.email, {
    challenge,
    token,
    expires: Date.now() + 60000 // 1 min
  });
  res.json({ challenge, token });
});

// Verify liveness result from frontend
router.post('/verify', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { token, passed } = req.body;
  const email = req.session.user.email;
  const stored = challenges.get(email);

  if (!stored || stored.token !== token || Date.now() > stored.expires) {
    return res.status(400).json({ error: 'Challenge expired or invalid' });
  }
  if (!passed) {
    return res.status(403).json({ error: 'Liveness check failed' });
  }

  // Mark liveness verified in session and DB
  req.session.liveness_verified = true;
  req.session.liveness_at = new Date().toISOString();
  challenges.delete(email);

  // Upsert user record
  const biometric_token = crypto.randomBytes(32).toString('hex');
  const db = prepare(`
    INSERT INTO users (email, name, picture, liveness_verified, liveness_verified_at, biometric_token)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT (email) DO UPDATE SET
      liveness_verified = 1,
      liveness_verified_at = EXCLUDED.liveness_verified_at,
      biometric_token = EXCLUDED.biometric_token
  `);
  await db.run(
    email,
    req.session.user.name,
    req.session.user.picture,
    new Date().toISOString(),
    biometric_token
  );

  res.json({ ok: true, biometric_token });
});

// Check liveness status
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session.user,
    liveness_verified: !!req.session.liveness_verified,
    liveness_at: req.session.liveness_at || null
  });
});

// Require liveness middleware — use on protected routes
function requireLiveness(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!req.session.liveness_verified) {
    return res.status(403).json({ error: 'Liveness verification required' });
  }
  next();
}

module.exports = { router, requireLiveness };