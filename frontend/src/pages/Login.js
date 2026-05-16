import React from 'react';

export default function Login() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">✉</div>
        <h1>MailBlast</h1>
        <p>Bulk Gmail sender — send to hundreds with one click</p>
        <a href="/auth/google" className="google-btn">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="20" />
          Sign in with Google
        </a>
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
