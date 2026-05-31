const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/index');
const { parseEmailList, parseFromText } = require('../services/parser');
const { sendCampaign } = require('../services/sender');
const { registerTokens, getTokensForUser } = require('../services/scheduler');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mailblast_jwt_secret';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  // Check session first
  if (req.session && req.session.user) return next();
  
  // Check JWT token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      req.session.user = decoded;
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  
  return res.status(401).json({ error: 'Not authenticated' });
}

// GET all campaigns
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, (SELECT COUNT(*) FROM open_events WHERE campaign_id = c.id) as open_count
      FROM campaigns c WHERE c.user_email = $1 ORDER BY c.created_at DESC
    `, [req.session.user.email]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create campaign
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, subject, body_html, body_text, from_name, from_email, track_opens } = req.body;
    if (!name || !subject || !body_html)
      return res.status(400).json({ error: 'name, subject, and body_html are required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO campaigns (id, user_email, name, subject, body_html, body_text, from_name, from_email, track_opens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, req.session.user.email, name, subject, body_html, body_text||'', from_name||'', from_email||req.session.user.email, track_opens?1:0]
    );
    res.json({ id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single campaign
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: camp } = await pool.query(
      'SELECT * FROM campaigns WHERE id=$1 AND user_email=$2',
      [req.params.id, req.session.user.email]
    );
    if (!camp[0]) return res.status(404).json({ error: 'Not found' });
    const { rows: recipients } = await pool.query('SELECT * FROM recipients WHERE campaign_id=$1', [req.params.id]);
    const { rows: opens } = await pool.query('SELECT * FROM open_events WHERE campaign_id=$1 ORDER BY opened_at DESC', [req.params.id]);
    const { rows: attachments } = await pool.query('SELECT id,filename,mimetype,size FROM attachments WHERE campaign_id=$1', [req.params.id]);
    res.json({ ...camp[0], recipients, opens, attachments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update campaign
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, subject, body_html, body_text, from_name, from_email, track_opens } = req.body;
    await pool.query(
      `UPDATE campaigns SET name=$1,subject=$2,body_html=$3,body_text=$4,from_name=$5,from_email=$6,track_opens=$7
       WHERE id=$8 AND user_email=$9`,
      [name, subject, body_html, body_text||'', from_name, from_email, track_opens?1:0, req.params.id, req.session.user.email]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST upload recipients
router.post('/:id/recipients/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = parseEmailList(req.file.buffer, req.file.originalname, req.file.mimetype);
    await pool.query("DELETE FROM recipients WHERE campaign_id=$1 AND status='pending'", [req.params.id]);
    for (const r of parsed) {
      await pool.query('INSERT INTO recipients (id,campaign_id,email,name) VALUES ($1,$2,$3,$4)',
        [uuidv4(), req.params.id, r.email, r.name||'']);
    }
    await pool.query('UPDATE campaigns SET total_recipients=$1 WHERE id=$2', [parsed.length, req.params.id]);
    res.json({ count: parsed.length, sample: parsed.slice(0,5) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST paste recipients
router.post('/:id/recipients/paste', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    const parsed = parseFromText(text);
    await pool.query("DELETE FROM recipients WHERE campaign_id=$1 AND status='pending'", [req.params.id]);
    for (const r of parsed) {
      await pool.query('INSERT INTO recipients (id,campaign_id,email,name) VALUES ($1,$2,$3,$4)',
        [uuidv4(), req.params.id, r.email, r.name||'']);
    }
    await pool.query('UPDATE campaigns SET total_recipients=$1 WHERE id=$2', [parsed.length, req.params.id]);
    res.json({ count: parsed.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST upload attachment
router.post('/:id/attachments', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const allowed = ['application/pdf','image/png','image/jpeg','image/gif'];
    if (!allowed.includes(req.file.mimetype))
      return res.status(400).json({ error: 'Only PDF and image attachments are supported' });
    const id = uuidv4();
    await pool.query('INSERT INTO attachments (id,campaign_id,filename,mimetype,size,data) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, req.params.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer]);
    res.json({ id, filename: req.file.originalname, size: req.file.size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE attachment
router.delete('/:id/attachments/:attId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM attachments WHERE id=$1 AND campaign_id=$2', [req.params.attId, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST send test email
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const { test_email } = req.body;
    if (!test_email) return res.status(400).json({ error: 'test_email required' });
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    let tokens = req.session.tokens || await getTokensForUser(req.session.user.email);
    if (!tokens) return res.status(401).json({ error: 'Gmail not authenticated' });
    const { sendTestEmail } = require('../services/sender');
    await sendTestEmail(camp[0], tokens, test_email);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET send now (SSE)
router.get('/:id/send', requireAuth, async (req, res) => {
  try {
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    let tokens = req.session.tokens || await getTokensForUser(req.session.user.email);
    if (!tokens) return res.status(401).json({ error: 'Gmail not authenticated' });
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.flushHeaders();
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    await sendCampaign(camp[0].id, tokens, (p) => send(p));
    send({ done: true });
  } catch (err) { res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`); }
  res.end();
});

// GET resend all (SSE)
router.get('/:id/resend-all', requireAuth, async (req, res) => {
  try {
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    let tokens = req.session.tokens || await getTokensForUser(req.session.user.email);
    if (!tokens) return res.status(401).json({ error: 'Gmail not authenticated' });
    await pool.query("UPDATE recipients SET status='pending', error=NULL WHERE campaign_id=$1", [req.params.id]);
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.flushHeaders();
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    await sendCampaign(camp[0].id, tokens, (p) => send(p));
    send({ done: true });
  } catch (err) { res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`); }
  res.end();
});

// GET resend failed (SSE)
router.get('/:id/resend-failed', requireAuth, async (req, res) => {
  try {
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    let tokens = req.session.tokens || await getTokensForUser(req.session.user.email);
    if (!tokens) return res.status(401).json({ error: 'Gmail not authenticated' });
    await pool.query("UPDATE recipients SET status='pending', error=NULL WHERE campaign_id=$1 AND status='failed'", [req.params.id]);
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.flushHeaders();
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    await sendCampaign(camp[0].id, tokens, (p) => send(p));
    send({ done: true });
  } catch (err) { res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`); }
  res.end();
});

// POST create resend rule
router.post('/:id/resend-rules', requireAuth, async (req, res) => {
  try {
    const { type, delay_minutes } = req.body;
    if (!type || !delay_minutes)
      return res.status(400).json({ error: 'type and delay_minutes required' });
    if (!['failed','unopened'].includes(type))
      return res.status(400).json({ error: 'type must be failed or unopened' });
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    await pool.query("DELETE FROM resend_rules WHERE campaign_id=$1 AND type=$2 AND status='pending'", [req.params.id, type]);
    const id = uuidv4();
    await pool.query('INSERT INTO resend_rules (id,campaign_id,type,delay_minutes) VALUES ($1,$2,$3,$4)',
      [id, req.params.id, type, delay_minutes]);
    res.json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET resend rules
router.get('/:id/resend-rules', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resend_rules WHERE campaign_id=$1', [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE resend rule
router.delete('/:id/resend-rules/:ruleId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM resend_rules WHERE id=$1 AND campaign_id=$2', [req.params.ruleId, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST schedule campaign
router.post('/:id/schedule', requireAuth, async (req, res) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
    const { rows: camp } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    if (!camp[0]) return res.status(404).json({ error: 'Campaign not found' });
    await registerTokens(req.session.user.email, req.session.tokens);
    const jobId = uuidv4();
    await pool.query('INSERT INTO scheduled_jobs (id,campaign_id,scheduled_at) VALUES ($1,$2,$3)', [jobId, req.params.id, scheduled_at]);
    await pool.query("UPDATE campaigns SET status='scheduled', scheduled_at=$1 WHERE id=$2", [scheduled_at, req.params.id]);
    res.json({ jobId, scheduled_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE cancel schedule
router.delete('/:id/schedule', requireAuth, async (req, res) => {
  try {
    await pool.query("UPDATE scheduled_jobs SET status='cancelled' WHERE campaign_id=$1 AND status='pending'", [req.params.id]);
    await pool.query("UPDATE campaigns SET status='draft', scheduled_at=NULL WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET unsubscribe
router.get('/unsubscribe/:campaignId/:email', async (req, res) => {
  const decodedEmail = decodeURIComponent(req.params.email);
  try {
    await pool.query("UPDATE recipients SET status='unsubscribed' WHERE campaign_id=$1 AND email=$2", [req.params.campaignId, decodedEmail]);
  } catch (e) {}
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px"><h2>✅ You have been unsubscribed</h2><p>You will no longer receive emails from this campaign.</p></body></html>');
});

// DELETE campaign
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM recipients WHERE campaign_id=$1', [req.params.id]);
    await pool.query('DELETE FROM attachments WHERE campaign_id=$1', [req.params.id]);
    await pool.query('DELETE FROM scheduled_jobs WHERE campaign_id=$1', [req.params.id]);
    await pool.query('DELETE FROM open_events WHERE campaign_id=$1', [req.params.id]);
    await pool.query('DELETE FROM resend_rules WHERE campaign_id=$1', [req.params.id]);
    await pool.query('DELETE FROM campaigns WHERE id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET open tracking pixel
router.get('/open/:campaignId/:recipientId', async (req, res) => {
  const cleanId = req.params.recipientId.replace('.png','');
  try {
    const { rows } = await pool.query('SELECT * FROM recipients WHERE id=$1', [cleanId]);
    if (rows[0]) {
      await pool.query('INSERT INTO open_events (id,campaign_id,recipient_id,email,ip,user_agent) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuidv4(), req.params.campaignId, cleanId, rows[0].email, req.ip, req.headers['user-agent']||'']);
    }
  } catch (e) {}
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
  res.set({'Content-Type':'image/png','Content-Length':pixel.length,'Cache-Control':'no-store'});
  res.send(pixel);
});

module.exports = router;