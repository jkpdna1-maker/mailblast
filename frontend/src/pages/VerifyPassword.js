import React, { useState } from 'react';

const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function VerifyPassword({ user, onDone, onLogout }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);

  const handleSubmit = async () => {
    if (!password) return setError('Enter your password');
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/auth/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.status === 403) {
        setLocked(true);
        setError(data.error);
        return;
      }
      if (!res.ok) return setError(data.error || 'Wrong password');
      onDone();
    } catch (e) {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🔒</div>
        <h1>MailBlast</h1>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <img src={user.picture} alt={user.name} style={{ width: 36, height: 36, borderRadius: '50%' }} />
            <span style={{ fontSize: 14, color: '#555' }}>{user.email}</span>
          </div>
        )}
        <p>Enter your MailBlast password to continue.</p>

        {locked ? (
          <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 8, padding: '16px', marginBottom: 16, fontSize: 14, color: '#c62828' }}>
            🔒 Account locked after 3 failed attempts.<br />Contact admin to unlock.
          </div>
        ) : (
          <>
            <div style={{ width: '100%', marginBottom: 12 }}>
              <input
                type="password"
                placeholder="Enter MailBlast password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                maxLength={16}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15, boxSizing: 'border-box' }}
                autoFocus
              />
            </div>
            {error && (
              <div style={{ color: '#c62828', marginBottom: 12, fontSize: 13 }}>{error}</div>
            )}
            <button
              className="google-btn"
              onClick={handleSubmit}
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </>
        )}

        <button
          onClick={onLogout}
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13 }}
        >
          Sign out and use a different account
        </button>
      </div>
    </div>
  );
}