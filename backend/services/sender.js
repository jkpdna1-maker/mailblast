const { getGmailClient } = require('./gmail');
const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');

function buildMimeMessage({ from, to, subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl, attachments = [] }) {
  const boundary = 'mailblast_' + Date.now();
  const hasAttachments = attachments.length > 0;
  const outerBoundary = 'outer_' + boundary;
  const innerBoundary = 'inner_' + boundary;

  const injectTracking = trackingPixelUrl
    ? htmlBody + `\n<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
    : htmlBody;

  const finalHtml = unsubscribeUrl
    ? injectTracking + `\n<p style="font-size:11px;color:#999;text-align:center;margin-top:20px"><a href="${unsubscribeUrl}">Unsubscribe</a></p>`
    : injectTracking;

  let lines = [];
  lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${subject}`);
  lines.push(`MIME-Version: 1.0`);
  if (unsubscribeUrl) lines.push(`List-Unsubscribe: <${unsubscribeUrl}>`);

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${outerBoundary}"`);
    lines.push('');
    lines.push(`--${outerBoundary}`);
    lines.push(`Content-Type: multipart/alternative; boundary="${innerBoundary}"`);
    lines.push('');
  } else {
    lines.push(`Content-Type: multipart/alternative; boundary="${innerBoundary}"`);
    lines.push('');
  }

  lines.push(`--${innerBoundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(textBody || stripHtml(htmlBody));
  lines.push('');

  lines.push(`--${innerBoundary}`);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('');
  lines.push(finalHtml);
  lines.push('');
  lines.push(`--${innerBoundary}--`);

  if (hasAttachments) {
    for (const att of attachments) {
      lines.push('');
      lines.push(`--${outerBoundary}`);
      lines.push(`Content-Type: ${att.mimetype}; name="${att.filename}"`);
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      const b64 = att.data.toString('base64');
      for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
    }
    lines.push('');
    lines.push(`--${outerBoundary}--`);
  }

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function personalize(template, name, email) {
  return template
    .replace(/\{\{name\}\}/gi, name || '')
    .replace(/\{\{email\}\}/gi, email || '');
}

function isBounce(errMsg) {
  const msg = (errMsg || '').toLowerCase();
  return msg.includes('bounce') || msg.includes('invalid') || msg.includes('does not exist') ||
    msg.includes('no such user') || msg.includes('user unknown') || msg.includes('550') ||
    msg.includes('551') || msg.includes('552') || msg.includes('553');
}

async function sendTestEmail(campaign, tokens, testEmail) {
  const gmail = getGmailClient(tokens);
  const rawMessage = buildMimeMessage({
    from: `${campaign.from_name} <${campaign.from_email}>`,
    to: testEmail,
    subject: `[TEST] ${campaign.subject}`,
    htmlBody: campaign.body_html,
    textBody: campaign.body_text || null,
  });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: rawMessage } });
}

async function sendCampaign(campaignId, tokens, onProgress) {
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const recipients = await db.prepare(
    "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'pending'"
  ).all(campaignId);

  const attachments = await db.prepare('SELECT * FROM attachments WHERE campaign_id = ?').all(campaignId);
  const gmail = getGmailClient(tokens);

  await db.prepare("UPDATE campaigns SET status = 'sending', sent_at = to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS') WHERE id = ?").run(campaignId);

  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    try {
      const trackingPixelUrl = campaign.track_opens
        ? `${process.env.TRACKING_BASE_URL}/track/open/${campaignId}/${recipient.id}.png`
        : null;

      const unsubscribeUrl = `${process.env.TRACKING_BASE_URL}/campaigns/unsubscribe/${campaignId}/${encodeURIComponent(recipient.email)}`;

      const personalizedHtml = personalize(campaign.body_html, recipient.name, recipient.email);
      const personalizedSubject = personalize(campaign.subject, recipient.name, recipient.email);

      const rawMessage = buildMimeMessage({
        from: `${campaign.from_name} <${campaign.from_email}>`,
        to: recipient.email,
        subject: personalizedSubject,
        htmlBody: personalizedHtml,
        textBody: campaign.body_text ? personalize(campaign.body_text, recipient.name, recipient.email) : null,
        trackingPixelUrl,
        unsubscribeUrl,
        attachments: attachments.map(a => ({ filename: a.filename, mimetype: a.mimetype, data: a.data }))
      });

      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: rawMessage } });

      await db.prepare("UPDATE recipients SET status = 'sent', sent_at = to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS') WHERE id = ?").run(recipient.id);

      sentCount++;
      if (onProgress) onProgress({ email: recipient.email, status: 'sent', sentCount, failedCount, total: recipients.length });
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      const errorMsg = err.message || 'Unknown error';
      const status = isBounce(errorMsg) ? 'bounced' : 'failed';
      await db.prepare("UPDATE recipients SET status = ?, error = ? WHERE id = ?").run(status, errorMsg, recipient.id);
      failedCount++;
      if (onProgress) onProgress({ email: recipient.email, status, error: errorMsg, sentCount, failedCount, total: recipients.length });
    }
  }

  await db.prepare("UPDATE campaigns SET status = 'sent', sent_count = ?, failed_count = ? WHERE id = ?").run(sentCount, failedCount, campaignId);
  return { sentCount, failedCount, total: recipients.length };
}

module.exports = { sendCampaign, sendTestEmail, buildMimeMessage };