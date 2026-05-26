const express = require('express');
const router = express.Router();
const { prepare, pool } = require('../db/database');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const challenges = new Map();
const MAX_FAILED = 3;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // your Gmail

// ─── Gmail alert sender ───────────────────────────────────────────────────────
async function sendLockAlert(email) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    await transporter.sendMail({
      from: `MailBlast Security <${process.env.GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: '🔒 MAILBLAST LOCKED — 3 failed face scans',
      html: `
        <h2>⚠️ Security Alert</h2>
        <p>MailBlast has been <strong>locked</strong> after 3 consecutive failed face recognition attempts.</p>
        <p><strong>Account:</strong> ${email}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p>All background jobs are still running. Only login is blocked.</p>
        <p>To unlock: open the app and pass face + eye + blink verification.</p>
        <hr/>
        <p style="color:#888;font-size:12px">If this was not you, your account may be compromised.</p>
      `,
    });
    console.log('[security] Lock alert email sent to', ADMIN_EMAIL);
  } catch (e) {
    console.error('[security] Failed to send lock alert:', e.message);
  }
}

// ─── Check if system is locked ───────────────────────────────────────────────
router.get('/lock-status', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.json({ locked: false });
  }
  const email = req.session.user.email;
  const row = await pool.query(
    'SELECT locked, failed_attempts FROM security_state WHERE email = $1',
    [email]
  );
  const state = row.rows[0];
  res.json({
    locked: state?.locked === 1,
    failed_attempts: state?.failed_attempts || 0,
  });
});

// ─── Check if face enrolled ──────────────────────────────────────────────────
router.get('/enrolled', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const email = req.session.user.email;
  const row = await pool.query(
    'SELECT email FROM face_descriptors WHERE email = $1',
    [email]
  );
  res.json({ enrolled: row.rows.length > 0 });
});

// ─── Enroll face (first time) ────────────────────────────────────────────────
router.post('/enroll', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { face_descriptor, eye_left_descriptor, eye_right_descriptor } = req.body;
  if (!face_descriptor) {
    return res.status(400).json({ error: 'face_descriptor required' });
  }
  const email = req.session.user.email;
  const now = new Date().toISOString();
  await pool.query(`
    INSERT INTO face_descriptors (email, face_descriptor, eye_left_descriptor, eye_right_descriptor, enrolled_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $5)
    ON CONFLICT (email) DO UPDATE SET
      face_descriptor = EXCLUDED.face_descriptor,
      eye_left_descriptor = EXCLUDED.eye_left_descriptor,
      eye_right_descriptor = EXCLUDED.eye_right_descriptor,
      updated_at = EXCLUDED.updated_at
  `, [
    email,
    JSON.stringify(face_descriptor),
    eye_left_descriptor ? JSON.stringify(eye_left_descriptor) : null,
    eye_right_descriptor ? JSON.stringify(eye_right_descriptor) : null,
    now,
  ]);

  // Reset security state on re-enrollment
  await pool.query(`
    INSERT INTO security_state (email, failed_attempts, locked)
    VALUES ($1, 0, 0)
    ON CONFLICT (email) DO UPDATE SET failed_attempts = 0, locked = 0, locked_at = NULL
  `, [email]);

  console.log('[liveness] Face enrolled for', email);
  res.json({ ok: true, message: 'Face enrolled successfully' });
});

// ─── Generate blink challenge ─────────────────────────────────────────────────
router.post('/challenge', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  challenges.set(req.session.user.email, {
    token,
    expires: Date.now() + 60000,
  });
  res.json({ token });
});

// ─── Verify face + eye + blink ───────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const email = req.session.user.email;
  const { token, face_descriptor, eye_left_descriptor, eye_right_descriptor, blink_detected, match_score } = req.body;

  // Check lock status first
  const stateRow = await pool.query(
    'SELECT locked, failed_attempts FROM security_state WHERE email = $1',
    [email]
  );
  const state = stateRow.rows[0];
  if (state?.locked === 1) {
    return res.status(403).json({ error: 'System locked. Face verification required to unlock.', locked: true });
  }

  // Validate challenge token
  const stored = challenges.get(email);
  if (!stored || stored.token !== token || Date.now() > stored.expires) {
    return res.status(400).json({ error: 'Challenge expired or invalid' });
  }
  challenges.delete(email);

  // Load enrolled descriptor
  const descRow = await pool.query(
    'SELECT face_descriptor, eye_left_descriptor, eye_right_descriptor FROM face_descriptors WHERE email = $1',
    [email]
  );

  if (descRow.rows.length === 0) {
    // Not enrolled yet — this is enrollment mode
    return res.status(400).json({ error: 'Not enrolled. Please enroll face first.', needs_enrollment: true });
  }

  const enrolled = descRow.rows[0];
  const enrolledFace = JSON.parse(enrolled.face_descriptor);

  // Compute Euclidean distance between descriptors
  function euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, v, i) => sum + Math.pow(v - b[i], 2), 0));
  }

  const incomingFace = face_descriptor;
  const faceDistance = euclideanDistance(enrolledFace, incomingFace);
  const faceMatch = faceDistance < 0.5; // threshold: <0.5 = same person

  // Eye match (optional but tightens security)
  let eyeMatch = true;
  if (enrolled.eye_left_descriptor && eye_left_descriptor) {
    const eyeDist = euclideanDistance(
      JSON.parse(enrolled.eye_left_descriptor),
      eye_left_descriptor
    );
    eyeMatch = eyeDist < 0.6;
  }

  const passed = faceMatch && eyeMatch && blink_detected;
  const now = new Date().toISOString();

  if (!passed) {
    // Increment failed attempts
    const newFailed = (state?.failed_attempts || 0) + 1;
    const shouldLock = newFailed >= MAX_FAILED;

    await pool.query(`
      INSERT INTO security_state (email, failed_attempts, locked, locked_at, last_attempt_at)
      VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT (email) DO UPDATE SET
        failed_attempts = $2,
        locked = $3,
        locked_at = CASE WHEN $3 = 1 THEN $4 ELSE security_state.locked_at END,
        last_attempt_at = $4
    `, [email, newFailed, shouldLock ? 1 : 0, now]);

    if (shouldLock) {
      // Send Gmail alert
      await sendLockAlert(email);
      return res.status(403).json({
        error: 'System locked after 3 failed attempts. Alert sent to admin.',
        locked: true,
        failed_attempts: newFailed,
      });
    }

    return res.status(403).json({
      error: 'Face not recognized',
      locked: false,
      failed_attempts: newFailed,
      remaining: MAX_FAILED - newFailed,
      face_distance: faceDistance,
      face_match: faceMatch,
      eye_match: eyeMatch,
      blink_detected,
    });
  }

  // ✅ Passed — reset failed attempts
  await pool.query(`
    INSERT INTO security_state (email, failed_attempts, locked, last_attempt_at)
    VALUES ($1, 0, 0, $2)
    ON CONFLICT (email) DO UPDATE SET
      failed_attempts = 0,
      locked = 0,
      locked_at = NULL,
      last_attempt_at = $2
  `, [email, now]);

  // Mark session verified
  req.session.liveness_verified = true;
  req.session.liveness_at = now;

  // Log attendance
  const attendanceId = crypto.randomBytes(16).toString('hex');
  await pool.query(`
    INSERT INTO attendance (id, email, punched_in_at, match_score, device_info)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    attendanceId,
    email,
    now,
    match_score || (1 - faceDistance),
    req.headers['user-agent'] || '',
  ]);

  // Update user record
  const biometric_token = crypto.randomBytes(32).toString('hex');
  await pool.query(`
    INSERT INTO users (email, name, picture, liveness_verified, liveness_verified_at, biometric_token)
    VALUES ($1, $2, $3, 1, $4, $5)
    ON CONFLICT (email) DO UPDATE SET
      liveness_verified = 1,
      liveness_verified_at = EXCLUDED.liveness_verified_at,
      biometric_token = EXCLUDED.biometric_token
  `, [
    email,
    req.session.user.name,
    req.session.user.picture,
    now,
    biometric_token,
  ]);

  console.log('[liveness] Verified for', email, '| face_distance:', faceDistance.toFixed(3));

  res.json({
    ok: true,
    biometric_token,
    attendance_id: attendanceId,
    punched_in_at: now,
    face_distance: faceDistance,
  });
});

// ─── Attendance history ───────────────────────────────────────────────────────
router.get('/attendance', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const rows = await pool.query(
    'SELECT * FROM attendance WHERE email = $1 ORDER BY punched_in_at DESC LIMIT 30',
    [req.session.user.email]
  );
  res.json({ attendance: rows.rows });
});

// ─── Liveness status ──────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session?.user,
    liveness_verified: !!req.session?.liveness_verified,
    liveness_at: req.session?.liveness_at || null,
  });
});

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireLiveness(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.session?.liveness_verified) return res.status(403).json({ error: 'Liveness verification required' });
  next();
}

module.exports = { router, requireLiveness };
