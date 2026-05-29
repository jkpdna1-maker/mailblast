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

const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [selectedId, setSelectedId] = useState(null);
  const [passwordStatus, setPasswordStatus] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('auth') === 'locked') {
      window.history.replaceState({}, '', '/');
      setLoading(false);
      return;
    }

    if (params.get('auth') === 'success') {
      const email = params.get('email');
      const name = params.get('name');
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
      const res = await fetch(`${BACKEND}/auth/password-status`, {
        credentials: 'include'
      });
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

  const openDetail = (id) => { setSelectedId(id); setPage('detail'); };
  const goCompose = () => { setSelectedId(null); setPage('compose'); };
  const goDashboard = () => setPage('dashboard');

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading...</span></div>;

  if (!user) return <Login />;

  // Show locked screen
  if (passwordStatus?.locked) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">🚫</div>
          <h1>Account Locked</h1>
          <p style={{ color: '#c62828' }}>Your account has been locked after 3 failed password attempts.</p>
          <p style={{ color: '#555', fontSize: 14 }}>Contact admin to unlock your account.</p>
          <button className="google-btn" onClick={handleLogout} style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // First time — set password
  if (passwordStatus && !passwordStatus.hasPassword) {
    return <SetPassword onDone={() => {
      setPasswordStatus({ hasPassword: true, passwordVerified: true });
    }} />;
  }

  // Has password but not verified yet
  if (passwordStatus && passwordStatus.hasPassword && !passwordStatus.passwordVerified) {
    return <VerifyPassword user={user} onDone={() => {
      setPasswordStatus(prev => ({ ...prev, passwordVerified: true }));
    }} onLogout={handleLogout} />;
  }

  // Waiting for password status to load
  if (!passwordStatus) {
    return <div className="loading"><div className="spinner" /><span>Loading...</span></div>;
  }

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
          <button className="nav-btn small" onClick={handleLogout}>Sign out</button>
        </div>
      </nav>
      <main className="main-content">
        {page === 'dashboard'  && <Dashboard onOpen={openDetail} onNew={goCompose} />}
        {page === 'compose'    && <Compose onSaved={openDetail} onBack={goDashboard} />}
        {page === 'detail'     && <CampaignDetail id={selectedId} onBack={goDashboard} />}
        {page === 'attendance' && <Attendance onBack={goDashboard} />}
      </main>
    </div>
  );
}