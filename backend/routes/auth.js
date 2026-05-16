const express = require('express');
const router = express.Router();
const { getAuthUrl, getTokensFromCode, getUserInfo } = require('../services/gmail');
const { registerTokens } = require('../services/scheduler');
require('dotenv').config();

// Step 1: Redirect user to Google login
router.get('/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// Step 2: Google redirects back here with a code
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  }

  try {
    const tokens = await getTokensFromCode(code);
    const user = await getUserInfo(tokens);

    req.session.tokens = tokens;
    req.session.user = {
      email: user.email,
      name: user.name,
      picture: user.picture
    };

    // Register tokens so scheduler can use them
    registerTokens(user.email, tokens);

    res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  }
});

// Get current logged-in user
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: req.session.user });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = router;
