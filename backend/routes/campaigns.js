const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { parseEmailList, parseFromText } = require('../services/parser');
const { sendCampaign } = require('../services/sender');
const { registerTokens } = require('../services/scheduler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const campaigns = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM open_events WHERE campaign_id = c.id) as open_count
    FROM campaigns c WHERE c.user_email = ? ORDER BY c.created_at DESC
  `).all(req.session.user.email);
  res.json(campaigns);
});

router.post('/', requireAuth, async (req, res) => {
  const { name, subject, body_html, body_text, from_name, from_email, track_opens } = req.body;
  if (!name || !subject || !body_html) {
    return res.status(400).json({ error: 'name, subject, and body_html are required' });
  }
  const id = uuidv4();
  await db.prepare(`INSERT INTO campaigns (id, user_email, name, subject, body_html, body_text, from_name, from_email, track_opens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.session.user.email, name, subject, body_html, body_text || '', from_name || '', from_email || req.session.user.email, track_opens ? 1 : 0);
  res.json({ id });
});

router.get('/:id', requireAuth, async (req, res) => {
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_email = ?')
    .get(req.params.id, req.session.user.email);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  const recipients = await db.prepare('SELECT * FROM recipients WHERE campaign_id = ?').all(req.params.id);
  const opens = await db.prepare('SELECT * FROM open_events WHERE campaign_id = ? ORDER BY opened_at DESC').all(req.params.id);
  const attachments = await db.prepare('SELECT id, filename, mimetype, size FROM attachments WHERE campaign_id = ?').all(req.params.id);
  res.json({ ...campaign, recipients, opens, attachments });
});

router.put('/:id', requireAuth, async (req, res) => {
  const { name, subject, body_html, body_text, from_name, from_email, track_opens } = req.body;
  await db.prepare(`UPDATE campaigns SET name=?, subject=?, body_html=?, body_text=?, from_name=?, from_email=?, track_opens=? WHERE id=? AND user_email=?`)
    .run(name, subject, body_html, body_text || '', from_name, from_email, track_opens ? 1 : 0, req.params.id, req.session.user.email);
  res.json({ ok: true });
});

router.post('/:id/recipients/upload', requireAuth, upload.single('file'), async (req, res) => {
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_email = ?')
    .get(req.params.id, req.session.user.email);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const parsed = parseEmailList(req.file.buffer, req.file.originalname, req.file.mimetype);
  await db.prepare("DELETE FROM recipients WHERE campaign_id = ? AND status = 'pending'").run(req.params.id);
  for (const r of parsed) {
    await db.prepare('INSERT INTO recipients (id, campaign_id, email, name) VALUES (?, ?, ?, ?)').run(uuidv4(), req.params.id, r.email, r.name || '');
  }
  await db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(parsed.length, req.params.id);
  res.json({ count: parsed.length, sample: parsed.slice(0, 5) });
});

router.post('/:id/recipients/paste', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_email = ?')
    .get(req.params.id, req.session.user.email);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const parsed = parseFromText(text);
  await db.prepare("DELETE FROM recipients WHERE campaign_id = ? AND status = 'pending'").run(req.params.id);
  for (const r of parsed) {
    await db.prepare('INSERT INTO recipients (id, campaign_id, email, name) VALUES (?, ?, ?, ?)').run(uuidv4(), req.params.id, r.email, r.name || '');
  }
  await db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(parsed.length, req.params.id);
  res.json({ count: parsed.length });
});

router.post('/:id/attachments', requireAuth, upload.single('pdf'), async (req, res) => {
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_email = ?')
    .get(req.params.id, req.session.user.email);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif'];
  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only PDF and image attachments are supported' });
  }
  const id = uuidv4();
  await db.prepare('INSERT INTO attachments (id, campaign_id, filename, mimetype, size, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer);
  res.json({ id, filename: req.file.originalname, size: req.file.size });
});

router.delete('/:id/attachments/:attId', requireAuth, async (req, res) => {
  await db.prepare('DELETE FROM attachments WHERE id = ? AND campaign_id = ?').run(req.params.attId, req.params.id);
  res.json({ ok: true });
});

router.get('/:id/send', requireAuth, async (req, res) => {
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_email = ?')
    .get(req.params.id, req.session.user.email);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const tokens = req.session.tokens;
  if (!tokens) return res.status(401).json({ error: 'Gmail not authenticated' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    await sendCampaign(campaign.id, tokens, (progress) => { send(progress); });
    send({ done: true });
  } catch (err) {
    send({ error: err.message, done: true });
  }
  res.end();
});

router.post('/:id/schedule', requireAuth, async (req, res) => {
  const { scheduled_at } = req.body;
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_email = ?')
    .get(req.params.id, req.session.user.email);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  registerTokens(req.session.user.email, req.session.tokens);
  const jobId = uuidv4();
  await db.prepare('INSERT INTO scheduled_jobs (id, campaign_id, scheduled_at) VALUES (?, ?, ?)').run(jobId, req.params.id, scheduled_at);
  await db.prepare("UPDATE campaigns SET status = 'scheduled', scheduled_at = ? WHERE id = ?").run(scheduled_at, req.params.id);
  res.json({ jobId, scheduled_at });
});

router.delete('/:id/schedule', requireAuth, async (req, res) => {
  await db.prepare("UPDATE scheduled_jobs SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'").run(req.params.id);
  await db.prepare("UPDATE campaigns SET status = 'draft', scheduled_at = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, async (req, res) => {
  await db.prepare('DELETE FROM recipients WHERE campaign_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM attachments WHERE campaign_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM scheduled_jobs WHERE campaign_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM open_events WHERE campaign_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM campaigns WHERE id = ? AND user_email = ?').run(req.params.id, req.session.user.email);
  res.json({ ok: true });
});

router.get('/open/:campaignId/:recipientId', async (req, res) => {
  const { campaignId, recipientId } = req.params;
  const cleanRecipientId = recipientId.replace('.png', '');
  try {
    const recipient = await db.prepare('SELECT * FROM recipients WHERE id = ?').get(cleanRecipientId);
    if (recipient) {
      await db.prepare('INSERT INTO open_events (id, campaign_id, recipient_id, email, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), campaignId, cleanRecipientId, recipient.email, req.ip, req.headers['user-agent'] || '');
    }
  } catch (e) {}
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  res.set({ 'Content-Type': 'image/png', 'Content-Length': pixel.length, 'Cache-Control': 'no-store' });
  res.send(pixel);
});

module.exports = router;