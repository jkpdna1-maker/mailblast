import React, { useState, useRef } from 'react';
import {
  createCampaign, uploadRecipients, pasteRecipients,
  uploadAttachment, deleteAttachment, scheduleCampaign, sendNow, sendTestEmail
} from '../api';

const TABS = ['paste', 'upload', 'manual'];

export default function Compose({ onSaved, onBack }) {
  const [step, setStep] = useState(1); // 1=recipients, 2=message, 3=send
  const [campaignId, setCampaignId] = useState(null);

  // Step 1 state
  const [recipientTab, setRecipientTab] = useState('paste');
  const [pasteText, setPasteText] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [recipients, setRecipients] = useState([]); // [{email, name}]
  const [uploadMsg, setUploadMsg] = useState('');

  // Step 2 state
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [trackOpens, setTrackOpens] = useState(true);
  const [attachments, setAttachments] = useState([]);
  const [campaignName, setCampaignName] = useState('');

  // Step 3 state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState([]);
  const [progressStats, setProgressStats] = useState(null);
  const [done, setDone] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSent, setTestSent] = useState(false);

  const fileRef = useRef();
  const pdfRef = useRef();
  const editorRef = useRef();

  // ── Step 1: Recipients ──────────────────────────────────────────

  const handleParse = () => {
    const lines = pasteText.split(/[\n\r,;\t ]+/).map(t => t.trim()).filter(Boolean);
    const valid = lines.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
    const unique = [...new Set(valid.map(e => e.toLowerCase()))].map(e => ({ email: e, name: '' }));
    setRecipients(unique);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadMsg('Parsing...');
    // Parse locally first for preview, then upload after campaign created
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Show filename as confirmation; actual parse happens server-side
      setUploadMsg(`File ready: ${file.name}`);
      // Store file for later
      fileRef._pendingFile = file;
    };
    reader.readAsText(file);
  };

  const addManual = () => {
    const e = manualEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return;
    if (recipients.find(r => r.email === e)) return;
    setRecipients([...recipients, { email: e, name: '' }]);
    setManualEmail('');
  };

  const removeRecipient = (email) => setRecipients(r => r.filter(x => x.email !== email));

  // ── Step 2: Message ─────────────────────────────────────────────

  const handlePdfUpload = async (e) => {
    if (!campaignId) return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const att = await uploadAttachment(campaignId, file);
      setAttachments(prev => [...prev, att]);
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const removeAtt = async (attId) => {
    if (!campaignId) return;
    await deleteAttachment(campaignId, attId);
    setAttachments(prev => prev.filter(a => a.id !== attId));
  };

  // ── Navigation between steps ────────────────────────────────────

  const goToStep2 = async () => {
    if (recipients.length === 0 && !fileRef._pendingFile) {
      alert('Please add at least one recipient.');
      return;
    }
    setStep(2);
  };

  const goToStep3 = async () => {
    if (!campaignName) { alert('Enter a campaign name.'); return; }
    if (!subject) { alert('Enter a subject line.'); return; }
    if (!bodyHtml && !editorRef.current?.value) { alert('Write your message.'); return; }

    try {
      // Create campaign
      const { id } = await createCampaign({
        name: campaignName,
        subject,
        body_html: bodyHtml || `<p>${editorRef.current?.value || ''}</p>`,
        from_name: fromName,
        from_email: fromEmail,
        track_opens: trackOpens
      });
      setCampaignId(id);

      // Upload recipients
      if (fileRef._pendingFile) {
        await uploadRecipients(id, fileRef._pendingFile);
      } else if (recipients.length > 0) {
        await pasteRecipients(id, recipients.map(r => r.email).join('\n'));
      }

      setStep(3);
    } catch (err) {
      alert('Error saving campaign: ' + (err.response?.data?.error || err.message));
    }
  };

  // ── Step 3: Send / Schedule ─────────────────────────────────────

  const handleTestSend = async () => {
    if (!testEmail) { alert('Enter a test email address.'); return; }
    if (!campaignId) { alert('Save the campaign first (go back to step 2 and click Next).'); return; }
    try {
      await sendTestEmail(campaignId, testEmail);
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (err) {
      alert('Test email failed: ' + err.message);
    }
  };
  const handleSend = async () => {
    if (!campaignId) return;

    if (scheduleEnabled) {
      if (!scheduleDate || !scheduleTime) { alert('Set date and time for scheduled send.'); return; }
      const isoStr = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      const scheduledTime = new Date(isoStr);
      if (scheduledTime < new Date()) { alert('Please choose a future date and time.'); return; }
      await scheduleCampaign(campaignId, isoStr);
      setDone(true);
      setProgress([{ msg: `Scheduled for ${scheduleDate} at ${scheduleTime}`, status: 'ok' }]);
      return;
    }

    setSending(true);
    setProgress([]);

    const es = sendNow(campaignId);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.done) {
        es.close();
        setSending(false);
        setDone(true);
        setProgressStats({ sent: data.sentCount, failed: data.failedCount, total: data.total });
      } else if (data.error && data.done) {
        es.close();
        setSending(false);
        setProgress(p => [...p, { msg: 'Error: ' + data.error, status: 'fail' }]);
      } else {
        setProgress(p => [...p, {
          msg: (data.status === 'sent' ? '✓ ' : '✗ ') + data.email,
          status: data.status
        }]);
        setProgressStats({ sent: data.sentCount, failed: data.failedCount, total: data.total });
      }
    };
    es.onerror = () => { es.close(); setSending(false); };
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2>New campaign</h2>
        <div className="step-indicators">
          {[1, 2, 3].map(s => (
            <span key={s} className={`step-dot ${step === s ? 'active' : step > s ? 'done' : ''}`}>{s}</span>
          ))}
        </div>
      </div>

      {/* STEP 1: RECIPIENTS */}
      {step === 1 && (
        <div className="card">
          <h3>Step 1 — Add recipients</h3>
          <div className="tab-bar">
            {TABS.map(t => <button key={t} className={`tab ${recipientTab === t ? 'on' : ''}`} onClick={() => setRecipientTab(t)}>{t === 'paste' ? 'Paste / type' : t === 'upload' ? 'Upload file' : 'Add one by one'}</button>)}
          </div>

          {recipientTab === 'paste' && (
            <div>
              <label>Paste emails — one per line, comma or space separated</label>
              <textarea rows={6} value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={'john@example.com\nsarah@firm.com\nravi@startup.in'} />
              <button className="btn-primary mt-sm" onClick={handleParse}>Parse emails</button>
            </div>
          )}

          {recipientTab === 'upload' && (
            <div>
              <label>Upload .csv, .xlsx, or .txt file — email column auto-detected</label>
              <div className="drop-zone" onClick={() => document.getElementById('list-file').click()}>
                <span>📂 Click to choose file</span>
                <span className="muted small">CSV, Excel, or plain text — one email per row</span>
              </div>
              <input id="list-file" type="file" accept=".csv,.xlsx,.txt" style={{ display: 'none' }} onChange={handleFileUpload} />
              {uploadMsg && <div className="success-msg">{uploadMsg}</div>}
            </div>
          )}

          {recipientTab === 'manual' && (
            <div>
              <label>Type an email and press Add or Enter</label>
              <div className="input-row">
                <input type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()} placeholder="someone@example.com" />
                <button className="btn-primary" onClick={addManual}>Add</button>
              </div>
            </div>
          )}

          {recipients.length > 0 && (
            <div className="recipient-preview">
              <div className="recipient-count">{recipients.length} recipient{recipients.length > 1 ? 's' : ''} ready</div>
              <div className="chip-list">
                {recipients.slice(0, 40).map(r => (
                  <span key={r.email} className="chip">{r.email} <span className="chip-rm" onClick={() => removeRecipient(r.email)}>×</span></span>
                ))}
                {recipients.length > 40 && <span className="chip chip-more">+{recipients.length - 40} more</span>}
              </div>
            </div>
          )}

          <div className="step-actions">
            <button className="btn-primary" onClick={goToStep2}>Next: Write message →</button>
          </div>
        </div>
      )}

      {/* STEP 2: MESSAGE */}
      {step === 2 && (
        <div className="card">
          <h3>Step 2 — Compose message</h3>
          <div className="form-group">
            <label>Campaign name (internal)</label>
            <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g. June newsletter" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>From name</label>
              <input type="text" value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Your Name" />
            </div>
            <div className="form-group">
              <label>From email (must match your Gmail)</label>
              <input type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="you@gmail.com" />
            </div>
          </div>
          <div className="form-group">
            <label>Subject line</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Enter subject..." />
          </div>
          <div className="form-group">
            <label>Message body — use {'{{name}}'} and {'{{email}}'} for personalization</label>
            <div className="editor-toolbar">
              <button className="tbtn" onClick={() => document.execCommand('bold')}><b>B</b></button>
              <button className="tbtn" onClick={() => document.execCommand('italic')}><i>I</i></button>
              <button className="tbtn" onClick={() => document.execCommand('underline')}><u>U</u></button>
              <button className="tbtn" onClick={() => {
                const url = window.prompt('URL:');
                if (url) document.execCommand('createLink', false, url);
              }}>Link</button>
              <span className="tb-sep" />
              <button className="tbtn" onClick={() => {
                const el = document.getElementById('body-editor');
                el.innerHTML += ' {{name}}';
              }}>+ name</button>
              <button className="tbtn" onClick={() => {
                const el = document.getElementById('body-editor');
                el.innerHTML += ' {{email}}';
              }}>+ email</button>
            </div>
            <div
              id="body-editor"
              ref={editorRef}
              className="rich-editor"
              contentEditable
              suppressContentEditableWarning
              onInput={e => setBodyHtml(e.currentTarget.innerHTML)}
              data-placeholder="Write your message here..."
            />
          </div>

          <div className="form-group">
            <label>PDF / image attachments (optional)</label>
            <button className="btn-outline" onClick={() => pdfRef.current.click()}>📎 Attach PDF or image</button>
            <input ref={pdfRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={handlePdfUpload} />
            {attachments.map(a => (
              <div key={a.id} className="attachment-row">
                <span>📄 {a.filename} ({Math.round(a.size / 1024)} KB)</span>
                <button className="btn-ghost danger" onClick={() => removeAtt(a.id)}>Remove</button>
              </div>
            ))}
            {!campaignId && attachments.length === 0 && (
              <div className="muted small">Save step 1 first — PDF uploads happen after campaign is saved</div>
            )}
          </div>

          <div className="check-row">
            <input type="checkbox" id="track" checked={trackOpens} onChange={e => setTrackOpens(e.target.checked)} />
            <label htmlFor="track">Track email opens</label>
          </div>

          <div className="step-actions">
            <button className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <button className="btn-primary" onClick={goToStep3}>Next: Review & send →</button>
          </div>
        </div>
      )}

      {/* STEP 3: SEND */}
      {step === 3 && (
        <div className="card">
          <h3>Step 3 — Send</h3>

          <div className="summary-box">
            <div className="summary-row"><span>Campaign</span><strong>{campaignName}</strong></div>
            <div className="summary-row"><span>Subject</span><strong>{subject}</strong></div>
            <div className="summary-row"><span>Recipients</span><strong>{recipients.length || '(from file)'}</strong></div>
            <div className="summary-row"><span>Attachments</span><strong>{attachments.length > 0 ? attachments.map(a => a.filename).join(', ') : 'None'}</strong></div>
            <div className="summary-row"><span>Track opens</span><strong>{trackOpens ? 'Yes' : 'No'}</strong></div>
          </div>

          <div className="check-row mt-sm">
            <input type="checkbox" id="schedule" checked={scheduleEnabled} onChange={e => setScheduleEnabled(e.target.checked)} />
            <label htmlFor="schedule">Schedule for later</label>
          </div>

          {scheduleEnabled && (
            <div className="form-row mt-sm">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Time (your local time)</label>
                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
              </div>
            </div>
          )}

          <div className="form-row mt-sm">
            <div className="form-group">
              <label>Send a test email first (optional)</label>
              <div className="input-row">
                <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@example.com" />
                <button className="btn-outline" onClick={handleTestSend}>{testSent ? '✓ Sent!' : 'Send test'}</button>
              </div>
            </div>
          </div>

          {!done && (
            <div className="step-actions">
              <button className="btn-ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn-primary large" onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : scheduleEnabled ? '📅 Schedule send' : '🚀 Send to all now'}
              </button>
            </div>
          )}

          {(progress.length > 0 || progressStats) && (
            <div className="progress-section">
              {progressStats && (
                <div className="progress-stats">
                  <span className="stat-ok">✓ {progressStats.sent} sent</span>
                  {progressStats.failed > 0 && <span className="stat-fail">✗ {progressStats.failed} failed</span>}
                  <span className="muted">of {progressStats.total}</span>
                </div>
              )}
              <div className="send-log">
                {progress.map((p, i) => (
                  <div key={i} className={`log-line ${p.status === 'sent' ? 'ok' : p.status === 'fail' ? 'fail' : ''}`}>{p.msg}</div>
                ))}
              </div>
            </div>
          )}

          {done && !scheduleEnabled && (
            <div className="done-banner">
              🎉 All done! View open tracking data in campaign details.
              <button className="btn-primary mt-sm" onClick={() => onSaved(campaignId)}>View campaign →</button>
            </div>
          )}
          {done && scheduleEnabled && (
            <div className="done-banner">
              📅 Campaign scheduled! It will send automatically at the chosen time.
              <button className="btn-primary mt-sm" onClick={() => onSaved(campaignId)}>View campaign →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}



