import React, { useState, useEffect } from 'react';
import { getCampaigns } from '../api';

const STATUS_BADGE = {
  draft: { label: 'Draft', cls: 'badge-gray' },
  scheduled: { label: 'Scheduled', cls: 'badge-blue' },
  sending: { label: 'Sending...', cls: 'badge-amber' },
  sent: { label: 'Sent', cls: 'badge-green' },
};

export default function Dashboard({ onOpen, onNew }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCampaigns().then(c => { setCampaigns(c); setLoading(false); });
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  const totalSent = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const totalOpens = campaigns.reduce((s, c) => s + (c.open_count || 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Campaigns</h2>
        <button className="btn-primary" onClick={onNew}>+ New campaign</button>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total campaigns</div><div className="stat-val">{campaigns.length}</div></div>
        <div className="stat-card"><div className="stat-label">Emails sent</div><div className="stat-val">{totalSent.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Total opens</div><div className="stat-val">{totalOpens.toLocaleString()}</div></div>
        <div className="stat-card">
          <div className="stat-label">Avg open rate</div>
          <div className="stat-val">{totalSent > 0 ? Math.round((totalOpens / totalSent) * 100) + '%' : '—'}</div>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✉</div>
          <p>No campaigns yet. Create your first one.</p>
          <button className="btn-primary" onClick={onNew}>Create campaign</button>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Recipients</th>
                <th>Sent</th>
                <th>Opens</th>
                <th>Open rate</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => {
                const openRate = c.sent_count > 0 ? Math.round((c.open_count / c.sent_count) * 100) : 0;
                const badge = STATUS_BADGE[c.status] || { label: c.status, cls: 'badge-gray' };
                return (
                  <tr key={c.id} onClick={() => onOpen(c.id)} className="table-row clickable">
                    <td>
                      <div className="campaign-name">{c.name}</div>
                      <div className="campaign-subject">{c.subject}</div>
                    </td>
                    <td>{c.total_recipients || 0}</td>
                    <td>{c.sent_count || 0}</td>
                    <td>{c.open_count || 0}</td>
                    <td>{c.sent_count > 0 ? openRate + '%' : '—'}</td>
                    <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                    <td className="muted">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
