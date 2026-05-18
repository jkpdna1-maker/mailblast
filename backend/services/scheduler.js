const cron = require('node-cron');
const db = require('../db/database');
const { sendCampaign } = require('./sender');

async function registerTokens(userEmail, tokens) {
  try {
    console.log('[tokens] Saving tokens for', userEmail);
    await db.prepare(`INSERT INTO user_tokens (user_email, tokens, updated_at) VALUES (?, ?, to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')) ON CONFLICT (user_email) DO UPDATE SET tokens = EXCLUDED.tokens, updated_at = EXCLUDED.updated_at`)
      .run(userEmail, JSON.stringify(tokens));
    console.log('[tokens] Saved successfully');
  } catch (err) {
    console.error('[tokens] Error saving tokens:', err.message);
  }
}

async function getTokensForUser(userEmail) {
  const row = await db.prepare('SELECT tokens FROM user_tokens WHERE user_email = ?').get(userEmail);
  return row ? JSON.parse(row.tokens) : null;
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString().slice(0, 16);
    console.log('[scheduler] Tick —', now);

    // Handle scheduled jobs
    const dueJobs = await db.prepare(`
      SELECT sj.*, c.user_email FROM scheduled_jobs sj
      JOIN campaigns c ON sj.campaign_id = c.id
      WHERE sj.status = 'pending'
      AND substr(sj.scheduled_at, 1, 16) <= ?
    `).all(now);
    console.log('[scheduler] Due jobs:', dueJobs.length);
    for (const job of dueJobs) {
      console.log(`[scheduler] Firing job ${job.id} for campaign ${job.campaign_id}`);
      await db.prepare("UPDATE scheduled_jobs SET status = 'running' WHERE id = ?").run(job.id);
      const tokens = await getTokensForUser(job.user_email);
      if (!tokens) {
        console.warn(`[scheduler] No tokens for ${job.user_email} — skipped`);
        await db.prepare("UPDATE scheduled_jobs SET status = 'no_auth' WHERE id = ?").run(job.id);
        continue;
      }
      try {
        await sendCampaign(job.campaign_id, tokens, ({ email, status }) => {
          console.log(`[scheduler] ${status}: ${email}`);
        });
        await db.prepare("UPDATE scheduled_jobs SET status = 'done' WHERE id = ?").run(job.id);
      } catch (err) {
        console.error(`[scheduler] Job ${job.id} failed:`, err.message);
        await db.prepare("UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?").run(job.id);
      }
    }

    // Handle auto-resend rules
    const dueRules = await db.prepare(`
      SELECT rr.*, c.user_email FROM resend_rules rr
      JOIN campaigns c ON rr.campaign_id = c.id
      WHERE rr.status = 'pending'
    `).all();

    for (const rule of dueRules) {
      const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(rule.campaign_id);
      if (!campaign || campaign.status !== 'sent') continue;

      const sentAt = new Date(campaign.sent_at);
      const triggerAt = new Date(sentAt.getTime() + rule.delay_minutes * 60 * 1000);
      if (new Date() < triggerAt) continue;

      console.log(`[scheduler] Auto-resend rule ${rule.id} type=${rule.type}`);
      await db.prepare("UPDATE resend_rules SET status = 'running' WHERE id = ?").run(rule.id);

      const tokens = await getTokensForUser(rule.user_email);
      if (!tokens) {
        console.warn(`[scheduler] No tokens for ${rule.user_email}`);
        await db.prepare("UPDATE resend_rules SET status = 'no_auth' WHERE id = ?").run(rule.id);
        continue;
      }

      try {
        if (rule.type === 'failed') {
          await db.prepare("UPDATE recipients SET status = 'pending', error = NULL WHERE campaign_id = ? AND status = 'failed'").run(rule.campaign_id);
        } else if (rule.type === 'unopened') {
          const opens = await db.prepare('SELECT DISTINCT email FROM open_events WHERE campaign_id = ?').all(rule.campaign_id);
          const openedEmails = new Set(opens.map(o => o.email));
          const recipients = await db.prepare("SELECT * FROM recipients WHERE campaign_id = ? AND status = 'sent'").all(rule.campaign_id);
          for (const r of recipients) {
            if (!openedEmails.has(r.email)) {
              await db.prepare("UPDATE recipients SET status = 'pending' WHERE id = ?").run(r.id);
            }
          }
        }
        await sendCampaign(rule.campaign_id, tokens, ({ email, status }) => {
          console.log(`[scheduler] auto-resend ${status}: ${email}`);
        });
        await db.prepare("UPDATE resend_rules SET status = 'done' WHERE id = ?").run(rule.id);
      } catch (err) {
        console.error(`[scheduler] Rule ${rule.id} failed:`, err.message);
        await db.prepare("UPDATE resend_rules SET status = 'failed' WHERE id = ?").run(rule.id);
      }
    }
  });
  console.log('[scheduler] Started — checking every minute for scheduled sends');
}
      console.log(`[scheduler] Firing job ${job.id} for campaign ${job.campaign_id}`);
      await db.prepare("UPDATE scheduled_jobs SET status = 'running' WHERE id = ?").run(job.id);
      const tokens = await getTokensForUser(job.user_email);
      if (!tokens) {
        console.warn(`[scheduler] No tokens for ${job.user_email} — skipped`);
        await db.prepare("UPDATE scheduled_jobs SET status = 'no_auth' WHERE id = ?").run(job.id);
        continue;
      }
      try {
        await sendCampaign(job.campaign_id, tokens, ({ email, status }) => {
          console.log(`[scheduler] ${status}: ${email}`);
        });
        await db.prepare("UPDATE scheduled_jobs SET status = 'done' WHERE id = ?").run(job.id);
      } catch (err) {
        console.error(`[scheduler] Job ${job.id} failed:`, err.message);
        await db.prepare("UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?").run(job.id);
      }
    }
  });
  console.log('[scheduler] Started — checking every minute for scheduled sends');
}

module.exports = { startScheduler, registerTokens, getTokensForUser };