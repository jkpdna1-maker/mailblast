const cron = require('node-cron');
const db = require('../db/database');
const { sendCampaign } = require('./sender');

function registerTokens(userEmail, tokens) {
  db.prepare(`INSERT OR REPLACE INTO user_tokens (user_email, tokens, updated_at) VALUES (?, ?, datetime('now'))`)
    .run(userEmail, JSON.stringify(tokens));
}

function getTokensForUser(userEmail) {
  const row = db.prepare('SELECT tokens FROM user_tokens WHERE user_email = ?').get(userEmail);
  return row ? JSON.parse(row.tokens) : null;
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString().slice(0, 16);
    console.log('[scheduler] Tick —', now);
    const dueJobs = db.prepare(`
      SELECT sj.*, c.user_email FROM scheduled_jobs sj
      JOIN campaigns c ON sj.campaign_id = c.id
      WHERE sj.status = 'pending'
      AND substr(sj.scheduled_at, 1, 16) <= ?
    `).all(now);
    console.log('[scheduler] Due jobs:', dueJobs.length);
    for (const job of dueJobs) {
      console.log(`[scheduler] Firing job ${job.id} for campaign ${job.campaign_id}`);
      db.prepare("UPDATE scheduled_jobs SET status = 'running' WHERE id = ?").run(job.id);
      const tokens = getTokensForUser(job.user_email);
      if (!tokens) {
        console.warn(`[scheduler] No tokens for ${job.user_email} — job ${job.id} skipped`);
        db.prepare("UPDATE scheduled_jobs SET status = 'no_auth' WHERE id = ?").run(job.id);
        continue;
      }
      try {
        await sendCampaign(job.campaign_id, tokens, ({ email, status }) => {
          console.log(`[scheduler] ${status}: ${email}`);
        });
        db.prepare("UPDATE scheduled_jobs SET status = 'done' WHERE id = ?").run(job.id);
      } catch (err) {
        console.error(`[scheduler] Job ${job.id} failed:`, err.message);
        db.prepare("UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?").run(job.id);
      }
    }
  });
  console.log('[scheduler] Started — checking every minute for scheduled sends');
}

module.exports = { startScheduler, registerTokens, getTokensForUser };