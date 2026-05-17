import React, { useState, useEffect } from 'react';
import { getMe, logout } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Compose from './pages/Compose';
import CampaignDetail from './pages/CampaignDetail';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard'); // dashboard | compose | detail
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      const email = params.get('email');
      const name = params.get('name');
      const picture = params.get('picture');
      if (email && name) {
        const u = { email, name, picture };
        setUser(u);
        localStorage.setItem('mb_user', JSON.stringify(u));
        setLoading(false);
        window.history.replaceState({}, '', '/');
        return;
      }
      window.history.replaceState({}, '', '/');
    }
    getMe().then(u => { setUser(u); localStorage.setItem('mb_user', JSON.stringify(u)); setLoading(false); }).catch(() => {
      const stored = localStorage.getItem('mb_user');
      if (stored) { setUser(JSON.parse(stored)); }
      setLoading(false);
    });
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    localStorage.removeItem('mb_user');
    setPage('dashboard');
  };

  const openDetail = (id) => { setSelectedId(id); setPage('detail'); };
  const goCompose = () => { setSelectedId(null); setPage('compose'); };
  const goDashboard = () => setPage('dashboard');

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading...</span></div>;
  if (!user) return <Login />;

  return (
    <div className="app-shell">
      <nav className="navbar">
        <div className="nav-brand" onClick={goDashboard}>
          <span className="nav-logo">✉</span> MailBlast
        </div>
        <div className="nav-links">
          <button className={`nav-btn ${page === 'dashboard' ? 'active' : ''}`} onClick={goDashboard}>Campaigns</button>
          <button className="nav-btn primary" onClick={goCompose}>+ New campaign</button>
        </div>
        <div className="nav-user">
          <img src={user.picture} alt={user.name} className="avatar" />
          <span className="user-name">{user.name}</span>
          <button className="nav-btn small" onClick={handleLogout}>Sign out</button>
        </div>
      </nav>

      <main className="main-content">
        {page === 'dashboard' && <Dashboard onOpen={openDetail} onNew={goCompose} />}
        {page === 'compose' && <Compose onSaved={openDetail} onBack={goDashboard} />}
        {page === 'detail' && <CampaignDetail id={selectedId} onBack={goDashboard} />}
      </main>
    </div>
  );
}
