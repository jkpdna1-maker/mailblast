import React, { useEffect, useState } from 'react';

const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function Attendance({ onBack }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BACKEND}/api/attendance`)
      .then(r => r.json())
      .then(d => { setRecords(d.attendance || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  };

  const scoreColor = (score) => {
    if (!score) return '#888';
    if (score > 0.7) return '#2e7d32';
    if (score > 0.5) return '#f57c00';
    return '#c62828';
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 20 }}>🕐 Attendance Log</h2>
      </div>

      {loading && <p style={{ color: '#888' }}>Loading...</p>}

      {!loading && records.length === 0 && (
        <p style={{ color: '#888', textAlign: 'center', marginTop: 40 }}>No attendance records yet.</p>
      )}

      {!loading && records.length > 0 && (
        <>
          {/* Today's summary */}
          {(() => {
            const today = new Date().toDateString();
            const todayRecord = records.find(r => new Date(r.punched_in_at).toDateString() === today);
            return todayRecord ? (
              <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: '#388e3c', fontWeight: 600, marginBottom: 4 }}>TODAY'S PUNCH-IN</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1b5e20' }}>{fmt(todayRecord.punched_in_at)}</div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                  Match score: <span style={{ color: scoreColor(todayRecord.match_score), fontWeight: 600 }}>
                    {todayRecord.match_score ? `${(todayRecord.match_score * 100).toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
                <div style={{ fontSize: 15, color: '#e65100' }}>⚠️ Not punched in today</div>
              </div>
            );
          })()}

          {/* History table */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #eee', background: '#fafafa', display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase' }}>Date & Time</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', textAlign: 'right' }}>Match</span>
            </div>
            {records.map((r, i) => (
              <div key={r.id} style={{ padding: '14px 20px', borderBottom: i < records.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, color: '#1a1a2e' }}>{fmt(r.punched_in_at)}</div>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                    {r.device_info ? r.device_info.split(' ').slice(0, 4).join(' ') : 'Unknown device'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: scoreColor(r.match_score) }}>
                  {r.match_score ? `${(r.match_score * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 16 }}>
            Showing last {records.length} records
          </div>
        </>
      )}
    </div>
  );
}
