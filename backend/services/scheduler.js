const cron = require('node-cron');
const pool = require('../db/index');
const { sendCampaign } = require('./sender');

async function registerTokens(userEmail, tokens) {
  try {
    console.log('[tokens] Saving tokens for', userEmail);
    await pool.query(
      `INSERT INTO user_tokens (user_email, tokens, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_email)
       DO UPDATE SET tokens = EXCLUDED.tokens, updated_at = NOW()`,
      [userEmail, JSON.stringify(tokens)]
    );
    console.log('[tokens] Saved successfully');
  } catch (err) {
    console.error('[tokens] Error saving tokens:', err.message);
  }
}

async function getTokensForUser(userEmail) {
  const res = await pool.query(
    'SELECT tokens FROM user_tokens WHERE user_email = $1',
    [userEmail]
  );
  return res.rows[0] ? JSON.parse(res.rows[0].tokens) : null;
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString().slice(0, 16);
    console.log('[scheduler] Tick —', now);

    // Handle scheduled jobs
    try {
      const { rows: dueJobs } = await pool.query(
        `SELECT sj.*, c.user_email FROM scheduled_jobs sj
         JOIN campaigns c ON sj.campaign_id = c.id
         WHERE sj.status = 'pending'
         AND LEFT(sj.scheduled_at::text, 16) <= $1`,
        [now]
      );
      console.log('[scheduler] Due jobs:', dueJobs.length);

      for (const job of dueJobs) {
        console.log(`[scheduler] Firing job ${job.id} for campaign ${job.campaign_id}`);
        await pool.query(
          "UPDATE scheduled_jobs SET status = 'running' WHERE id = $1",
          [job.id]
        );
        const tokens = await getTokensForUser(job.user_email);
        if (!tokens) {
          console.warn(`[scheduler] No tokens for ${job.user_email} — skipped`);
          await pool.query(
            "UPDATE scheduled_jobs SET status = 'no_auth' WHERE id = $1",
            [job.id]
          );
          continue;
        }
        try {
          await sendCampaign(job.campaign_id, tokens, ({ email, status }) => {
            console.log(`[scheduler] ${status}: ${email}`);
          });
          await pool.query(
            "UPDATE scheduled_jobs SET status = 'done' WHERE id = $1",
            [job.id]
          );
        } catch (err) {
          console.error(`[scheduler] Job ${job.id} failed:`, err.message);
          await pool.query(
            "UPDATE scheduled_jobs SET status = 'failed' WHERE id = $1",
            [job.id]
          );
        }
      }
    } catch (err) {
      console.error('[scheduler] Scheduled jobs error:', err.message);
    }

    // Handle auto-resend rules
    try {
      const { rows: dueRules } = await pool.query(
        `SELECT rr.*, c.user_email FROM resend_rules rr
         JOIN campaigns c ON rr.campaign_id = c.id
         WHERE rr.status = 'pending'`
      );

      for (const rule of dueRules) {
        const { rows: campRows } = await pool.query(
          'SELECT * FROM campaigns WHERE id = $1',
          [rule.campaign_id]
        );
        const campaign = campRows[0];
        if (!campaign || campaign.status !== 'sent') continue;

        const sentAt = new Date(campaign.sent_at);
        const triggerAt = new Date(sentAt.getTime() + rule.delay_minutes * 60 * 1000);
        if (new Date() < triggerAt) continue;

        console.log(`[scheduler] Auto-resend rule ${rule.id} type=${rule.type}`);
        await pool.query(
          "UPDATE resend_rules SET status = 'running' WHERE id = $1",
          [rule.id]
        );

        const tokens = await getTokensForUser(rule.user_email);
        if (!tokens) {
          console.warn(`[scheduler] No tokens for ${rule.user_email}`);
          await pool.query(
            "UPDATE resend_rules SET status = 'no_auth' WHERE id = $1",
            [rule.id]
          );
          continue;
        }

        try {
          if (rule.type === 'failed') {
            await pool.query(
              "UPDATE recipients SET status = 'pending', error = NULL WHERE campaign_id = $1 AND status = 'failed'",
              [rule.campaign_id]
            );
          } else if (rule.type === 'unopened') {
            const { rows: opens } = await pool.query(
              'SELECT DISTINCT email FROM open_events WHERE campaign_id = $1',
              [rule.campaign_id]
            );
            const openedEmails = new Set(opens.map(o => o.email));
            const { rows: recipients } = await pool.query(
              "SELECT * FROM recipients WHERE campaign_id = $1 AND status = 'sent'",
              [rule.campaign_id]
            );
            for (const r of recipients) {
              if (!openedEmails.has(r.email)) {
                await pool.query(
                  "UPDATE recipients SET status = 'pending' WHERE id = $1",
                  [r.id]
                );
              }
            }
          }

          await sendCampaign(rule.campaign_id, tokens, ({ email, status }) => {
            console.log(`[scheduler] auto-resend ${status}: ${email}`);
          });
          await pool.query(
            "UPDATE resend_rules SET status = 'done' WHERE id = $1",
            [rule.id]
          );
        } catch (err) {
          console.error(`[scheduler] Rule ${rule.id} failed:`, err.message);
          await pool.query(
            "UPDATE resend_rules SET status = 'failed' WHERE id = $1",
            [rule.id]
          );
        }
      }
    } catch (err) {
      console.error('[scheduler] Auto-resend rules error:', err.message);
    }
  });

  console.log('[scheduler] Started — checking every minute for scheduled sends');
}

module.exports = { startScheduler, registerTokens, getTokensForUser };