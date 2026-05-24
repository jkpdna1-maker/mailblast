import React, { useEffect, useState } from 'react';
import LivenessCheck from '../LivenessCheck';

const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function Login() {
  const [step, setStep] = useState('login'); // login | liveness | done

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      setStep('liveness');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleLivenessSuccess = async (biometric_token) => {
    setStep('done');
    window.location.href = '/dashboard';
  };

  const handleLivenessFail = () => {
    setStep('login');
    alert('Liveness check failed. Please try again.');
  };

  if (step === 'liveness') {
    return <LivenessCheck onSuccess={handleLivenessSuccess} onFail={handleLivenessFail} />;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">✉</div>
        <h1>MailBlast</h1>
        <p>Bulk Gmail sender — send to hundreds with one click</p>
        <a href={`${BACKEND}/auth/google`} className="google-btn">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="20" />
          Sign in with Google
        </a>
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#e8f5e9', borderRadius: 8, fontSize: 13, color: '#2e7d32' }}>
          🔐 Liveness verification required after login
        </div>
        <ul className="feature-list">
          <li>✓ Upload CSV / Excel / paste emails</li>
          <li>✓ Rich text message with PDF attachment</li>
          <li>✓ Schedule send for any date & time</li>
          <li>✓ Track who opened your email</li>
        </ul>
      </div>
    </div>
  );
}