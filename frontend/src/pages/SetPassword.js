import React, { useState } from 'react';

const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function SetPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = () => {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (password.length > 16) return 'Password must be max 16 characters';
    if (password !== confirm) return 'Passwords do not match';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) return setError(err);
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/auth/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to set password');
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
        <div className="login-logo">🔐</div>
        <h1>Set MailBlast Password</h1>
        <p>Create a password to secure your account. You'll need this every time you log in.</p>
        <div style={{ width: '100%', marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Password (8-16 characters)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            maxLength={16}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ width: '100%', marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            maxLength={16}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15, boxSizing: 'border-box' }}
          />
        </div>
        {error && <div style={{ color: '#c62828', marginBottom: 12, fontSize: 13 }}>{error}</div>}
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Min 8, max 16 characters. Letters, numbers, symbols allowed.
        </div>
        <button
          className="google-btn"
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loading ? 'Setting password...' : 'Set Password'}
        </button>
      </div>
    </div>
  );
}