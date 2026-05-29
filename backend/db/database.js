require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_text TEXT,
      from_name TEXT NOT NULL,
      from_email TEXT NOT NULL,
      track_opens INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      scheduled_at TEXT,
      sent_at TEXT,
      total_recipients INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipients (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'pending',
      sent_at TEXT,
      error TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS open_events (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      email TEXT NOT NULL,
      opened_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS'),
      ip TEXT,
      user_agent TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER,
      data BYTEA
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resend_rules (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      type TEXT NOT NULL,
      delay_minutes INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      user_email TEXT PRIMARY KEY,
      tokens TEXT NOT NULL,
      updated_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT,
      picture TEXT,
      liveness_verified INTEGER DEFAULT 0,
      liveness_verified_at TEXT,
      biometric_token TEXT,
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS'),
      mb_password TEXT,
      mb_failed_attempts INTEGER DEFAULT 0,
      mb_locked INTEGER DEFAULT 0,
      mb_locked_at TEXT
    )
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mb_password TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mb_failed_attempts INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mb_locked INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mb_locked_at TEXT;
  `);

  // Face + eye descriptors (128-float arrays stored as JSON)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS face_descriptors (
      email TEXT PRIMARY KEY,
      face_descriptor TEXT NOT NULL,
      eye_left_descriptor TEXT,
      eye_right_descriptor TEXT,
      enrolled_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS'),
      updated_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')
    )
  `);

  // Attendance log — one row per login
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      punched_in_at TEXT NOT NULL,
      match_score REAL,
      device_info TEXT,
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')
    )
  `);

  // Security state — tracks failed attempts and lock status
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_state (
      email TEXT PRIMARY KEY,
      failed_attempts INTEGER DEFAULT 0,
      locked INTEGER DEFAULT 0,
      locked_at TEXT,
      last_attempt_at TEXT,
      lock_alert_sent INTEGER DEFAULT 0
    )
  `);

  console.log('[db] Tables ready');
}
function prepare(sql) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return {
    get: async (...params) => {
      const flat = params.flat();
      const result = await pool.query(pgSql, flat);
      return result.rows[0] || undefined;
    },
    all: async (...params) => {
      const flat = params.flat();
      const result = await pool.query(pgSql, flat);
      return result.rows;
    },
    run: async (...params) => {
      const flat = params.flat();
      await pool.query(pgSql, flat);
      return { changes: 1 };
    }
  };
}
async function exec(sql) {
  await pool.query(sql);
}
module.exports = { initDb, prepare, exec, pool };
