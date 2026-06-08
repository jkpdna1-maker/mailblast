// build-202606051200
import React, { useState, useEffect } from 'react';
import { getMe, logout } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Compose from './pages/Compose';
import CampaignDetail from './pages/CampaignDetail';
import Attendance from './pages/Attendance';
import SetPassword from './pages/SetPassword';
import VerifyPassword from './pages/VerifyPassword';
import './App.css';

const BACKEND = process.env.REACT_APP_API_URL || 'https://mailblast-api.onrender.com';

export default function App() {
  const [user, setUser]                   = useState(null);
  const [loading, setLoading]             = useState(true);
  const [page, setPage]                   = useState('dashboard');
  const [selectedId, setSelectedId]       = useState(null);
  const [passwordStatus, setPasswordStatus] = useState(null);
  const [showChangePw, setShowChangePw]   = useState(false);
  const [pwForm, setPwForm]               = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError]             = useState('');
  const [pwLoading, setPwLoading]         = useState(false);
  const [pwSuccess, setPwSuccess]         = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'locked') {
      window.history.replaceState({}, '', '/');
      setLoading(false);
      return;
    }
    if (params.get('auth') === 'success') {
      const email   = params.get('email');
      const name    = params.get('name');
      const picture = params.get('picture');
      if (email && name) {
        const u = { email, name, picture };
        setUser(u);
        localStorage.setItem('mb_user', JSON.stringify(u));
        window.history.replaceState({}, '', '/');
        checkPasswordStatus();
        setLoading(false);
        return;
      }
      window.history.replaceState({}, '', '/');
    }
    getMe()
      .then(async (data) => {
        setUser(data.user);
        localStorage.setItem('mb_user', JSON.stringify(data.user));
        if (data.passwordVerified) {
          setPasswordStatus({ hasPassword: true, passwordVerified: true });
        } else {
          await checkPasswordStatus();
        }
        setLoading(false);
      })
      .catch(() => {
        const stored = localStorage.getItem('mb_user');
        if (stored) setUser(JSON.parse(stored));
        setLoading(false);
      });
  }, []);

  const checkPasswordStatus = async () => {
    try {
      const res  = await fetch(`${BACKEND}/auth/password-status`, { credentials: 'include' });
      const data = await res.json();
      setPasswordStatus(data);
    } catch (e) {
      setPasswordStatus({ hasPassword: false, locked: false });
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setPasswordStatus(null);
    localStorage.removeItem('mb_user');
    setPage('dashboard');
  };

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess('');
    if (!pwForm.current) { setPwError('Enter current password'); return; }
    if (pwForm.next.length < 6 || pwForm.next.length > 16) { setPwError('New password must be 6-16 characters'); return; }
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match'); return; }
    setPwLoading(true);
    try {
      // verify current password first
      const verifyRes = await fetch(`${BACKEND}/auth/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: pwForm.current }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) { setPwError(verifyData.error || 'Current password incorrect'); setPwLoading(false); return; }

      // set new password
      const setRes = await fetch(`${BACKEND}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: pwForm.next }),
      });
      const setData = await setRes.json();
      if (!setRes.ok) { setPwError(setData.error || 'Failed to change password'); setPwLoading(false); return; }

      setPwSuccess('Password changed successfully!');
      setPwForm({ current: '', next: '', confirm: '' });
      setTimeout(() => { setShowChangePw(false); setPwSuccess(''); }, 2000);
    } catch (e) {
      setPwError('Network error');
    } finally {
      setPwLoading(false);
    }
  };

  const openDetail = (id) => { setSelectedId(id); setPage('detail'); };
  const goCompose  = () => { setSelectedId(null); setPage('compose'); };
  const goDashboard = () => setPage('dashboard');

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading...</span></div>;
  if (!user)   return <Login />;

  if (passwordStatus?.locked) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">🚫</div>
          <h1>Account Locked</h1>
          <p style={{ color: '#c62828' }}>Your account has been locked after 3 failed password attempts.</p>
          <p style={{ color: '#555', fontSize: 14 }}>Contact admin to unlock your account.</p>
          <button className="google-btn" onClick={handleLogout} style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>Sign out</button>
        </div>
      </div>
    );
  }

  if (passwordStatus && !passwordStatus.hasPassword) {
    return <SetPassword onDone={() => setPasswordStatus({ hasPassword: true, passwordVerified: true })} />;
  }

  if (passwordStatus && passwordStatus.hasPassword && !passwordStatus.passwordVerified) {
    return <VerifyPassword user={user} onDone={() => setPasswordStatus(prev => ({ ...prev, passwordVerified: true }))} onLogout={handleLogout} />;
  }

  if (!passwordStatus) return <div className="loading"><div className="spinner" /><span>Loading...</span></div>;

  return (
    <div className="app-shell">
      <nav className="navbar">
        <div className="nav-brand" onClick={goDashboard}>
          <span className="nav-logo">✉</span> MailBlast
        </div>
        <div className="nav-links">
          <button className={`nav-btn ${page === 'dashboard' ? 'active' : ''}`} onClick={goDashboard}>Campaigns</button>
          <button className={`nav-btn ${page === 'attendance' ? 'active' : ''}`} onClick={() => setPage('attendance')}>Attendance</button>
          <button className="nav-btn primary" onClick={goCompose}>+ New campaign</button>
        </div>
        <div className="nav-user">
          <img src={user.picture} alt={user.name} className="avatar" />
          <span className="user-name">{user.name}</span>
          <button className="nav-btn small" onClick={() => { setShowChangePw(true); setPwError(''); setPwSuccess(''); }}>🔑 Password</button>
          <button className="nav-btn small" onClick={handleLogout}>Sign out</button>
        </div>
      </nav>

      <main className="main-content">
        {page === 'dashboard'  && <Dashboard onOpen={openDetail} onNew={goCompose} />}
        {page === 'compose'    && <Compose onSaved={openDetail} onBack={goDashboard} />}
        {page === 'detail'     && <CampaignDetail id={selectedId} onBack={goDashboard} />}
        {page === 'attendance' && <Attendance onBack={goDashboard} />}
      </main>

      {/* Change Password Modal */}
      {showChangePw && (
        <div style={styles.overlay} onClick={() => setShowChangePw(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>🔑 Change Password</h2>
            <input
              style={styles.input}
              type="password"
              placeholder="Current password"
              value={pwForm.current}
              onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
            />
            <input
              style={styles.input}
              type="password"
              placeholder="New password (6-16 chars)"
              value={pwForm.next}
              onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Confirm new password"
              value={pwForm.confirm}
              onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
            />
            {pwError   && <div style={styles.error}>{pwError}</div>}
            {pwSuccess && <div style={styles.success}>{pwSuccess}</div>}
            <div style={styles.btnRow}>
              <button style={styles.primaryBtn} onClick={handleChangePassword} disabled={pwLoading}>
                {pwLoading ? 'Changing...' : 'Change Password'}
              </button>
              <button style={styles.cancelBtn} onClick={() => setShowChangePw(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:      { background: '#1a1a2e', borderRadius: 12, padding: 32, width: 340, display: 'flex', flexDirection: 'column', gap: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 700, margin: 0 },
  input:      { padding: '12px 16px', borderRadius: 8, border: '1px solid #333', background: '#0f0f1a', color: '#fff', fontSize: 14, outline: 'none' },
  error:      { color: '#ef5350', fontSize: 13 },
  success:    { color: '#66bb6a', fontSize: 13 },
  btnRow:     { display: 'flex', gap: 10, marginTop: 4 },
  primaryBtn: { flex: 1, padding: '12px 0', background: '#4285F4', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  cancelBtn:  { flex: 1, padding: '12px 0', background: '#333', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
};