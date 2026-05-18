import React, { useState, useEffect } from 'react';
import { getCampaign, cancelSchedule, sendNow, deleteCampaign, resendFailed, resendAll, sendTestEmail, getResendRules, createResendRule, deleteResendRule } from '../api';

export default function CampaignDetail({ id, onBack }) {
  const [campaign, setCampaign] = useState(null);
  const [tab, setTab] = useState('overview');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState([]);
  const [rules, setRules] = useState([]);
  const [ruleType, setRuleType] = useState('failed');
  const [ruleDelay, setRuleDelay] = useState(60);

  useEffect(() => {
    getCampaign(id).then(setCampaign);
    getResendRules(id).then(setRules);
  }, [id]);

  const refresh = () => { getCampaign(id).then(setCampaign); getResendRules(id).then(setRules); };

  const handleCancel = async () => {
    await cancelSchedule(id);
    refresh();
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this campaign?')) return;
    await deleteCampaign(id);
    onBack();
  };
  
  const handleResendFailed = async () => {
    setSending(true);
    setProgress([]);
    const es = resendFailed(id);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.done) { es.close(); setSending(false); refresh(); }
      else setProgress(p => [...p, { msg: (data.status === 'sent' ? '✓ ' : '✗ ') + data.email, status: data.status }]);
    };
    es.onerror = () => { es.close(); setSending(false); };
  };
  const handleResend = async () => {
    setSending(true);
    setProgress([]);
    const es = resendAll(id);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.done) { es.close(); setSending(false); refresh(); }
      else setProgress(p => [...p, { msg: (data.status === 'sent' ? '✓ ' : '✗ ') + data.email, status: data.status }]);
    };
    es.onerror = () => { es.close(); setSending(false); };
  };

  if (!campaign) return <div className="loading"><div className="spinner" /></div>;

  const openRate = campaign.sent_count > 0
    ? Math.round((campaign.opens?.length || 0) / campaign.sent_count * 100) : 0;

  const uniqueOpeners = new Set((campaign.opens || []).map(o => o.email)).size;

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2>{campaign.name}</h2>
        <div style={{display:'flex', gap:'8px'}}>
          <button className="btn-outline danger" onClick={handleDelete}>Delete</button>
          {campaign.status === 'scheduled' && (
            <button className="btn-outline danger" onClick={handleCancel}>Cancel schedule</button>
          )}
          {campaign.status === 'sent' && (
            <button className="btn-primary" onClick={handleResend} disabled={sending}>
              {sending ? 'Sending...' : 'Resend all'}
            </button>
          )}
          {campaign.status === 'sent' && campaign.failed_count > 0 && (
            <button className="btn-outline" onClick={handleResendFailed} disabled={sending}>
              {sending ? 'Sending...' : `Resend failed (${campaign.failed_count})`}
            </button>
          )}
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Recipients</div><div className="stat-val">{campaign.total_recipients}</div></div>
        <div className="stat-card"><div className="stat-label">Sent</div><div className="stat-val">{campaign.sent_count}</div></div>
        <div className="stat-card"><div className="stat-label">Unique opens</div><div className="stat-val">{uniqueOpeners}</div></div>
        <div className="stat-card"><div className="stat-label">Open rate</div><div className="stat-val">{openRate}%</div></div>
        {campaign.failed_count > 0 && (
          <div className="stat-card danger"><div className="stat-label">Failed</div><div className="stat-val">{campaign.failed_count}</div></div>
        )}
      </div>

      <div className="tab-bar">
        {['overview', 'opens', 'recipients'].map(t => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

{campaign.status === 'sent' && (
        <div className="card mt-sm">
          <h4>Auto-resend rules</h4>
          <div className="form-row">
            <div className="form-group">
              <label>Type</label>
              <select value={ruleType} onChange={e => setRuleType(e.target.value)}>
                <option value="failed">Resend to failed</option>
                <option value="unopened">Resend to unopened</option>
              </select>
            </div>
            <div className="form-group">
              <label>Delay (minutes)</label>
              <input type="number" value={ruleDelay} onChange={e => setRuleDelay(Number(e.target.value))} min={5} />
            </div>
            <div className="form-group" style={{display:'flex',alignItems:'flex-end'}}>
              <button className="btn-primary" onClick={async () => {
                await createResendRule(id, ruleType, ruleDelay);
                getResendRules(id).then(setRules);
              }}>Add rule</button>
            </div>
          </div>
          {rules.length > 0 && (
            <table className="table mt-sm">
              <thead><tr><th>Type</th><th>Delay</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td>{r.type}</td>
                    <td>{r.delay_minutes} min</td>
                    <td><span className={`badge badge-${r.status === 'done' ? 'green' : r.status === 'failed' ? 'red' : 'gray'}`}>{r.status}</span></td>
                    <td><button className="btn-ghost danger" onClick={async () => { await deleteResendRule(id, r.id); getResendRules(id).then(setRules); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'overview' && (
        <div className="card">
          <div className="summary-box">
            <div className="summary-row"><span>Subject</span><strong>{campaign.subject}</strong></div>
            <div className="summary-row"><span>From</span><strong>{campaign.from_name} &lt;{campaign.from_email}&gt;</strong></div>
            <div className="summary-row"><span>Status</span><strong>{campaign.status}</strong></div>
            <div className="summary-row"><span>Track opens</span><strong>{campaign.track_opens ? 'Yes' : 'No'}</strong></div>
            {campaign.scheduled_at && <div className="summary-row"><span>Scheduled</span><strong>{new Date(campaign.scheduled_at).toLocaleString()}</strong></div>}
            {campaign.sent_at && <div className="summary-row"><span>Sent at</span><strong>{new Date(campaign.sent_at).toLocaleString()}</strong></div>}
            {campaign.attachments?.length > 0 && (
              <div className="summary-row"><span>Attachments</span><strong>{campaign.attachments.map(a => a.filename).join(', ')}</strong></div>
            )}
          </div>
          <div className="mt-sm">
            <label className="muted small">Message preview</label>
            <div className="email-preview" dangerouslySetInnerHTML={{ __html: campaign.body_html }} />
          </div>
          {progress.length > 0 && (
            <div className="send-log mt-sm">
              {progress.map((p, i) => (
                <div key={i} className={`log-line ${p.status === 'sent' ? 'ok' : 'fail'}`}>{p.msg}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'opens' && (
        <div className="card">
          {!campaign.track_opens ? (
            <div className="muted">Open tracking was disabled for this campaign.</div>
          ) : campaign.opens?.length === 0 ? (
            <div className="muted">No opens recorded yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Opened at</th>
                  <th>User agent (device)</th>
                </tr>
              </thead>
              <tbody>
                {campaign.opens.map(o => (
                  <tr key={o.id}>
                    <td>{o.email}</td>
                    <td>{new Date(o.opened_at).toLocaleString()}</td>
                    <td className="muted small">{o.user_agent ? o.user_agent.substring(0, 60) + (o.user_agent.length > 60 ? '...' : '') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'recipients' && (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Name</th><th>Status</th><th>Sent at</th></tr>
            </thead>
            <tbody>
              {campaign.recipients?.map(r => (
                <tr key={r.id}>
                  <td>{r.email}</td>
                  <td className="muted">{r.name || '—'}</td>
                  <td>
                    <span className={`badge ${r.status === 'sent' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : 'badge-gray'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="muted small">{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}