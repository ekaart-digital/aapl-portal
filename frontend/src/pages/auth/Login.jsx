import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { landingFor } from '../../auth/roles';
import { IDLE_NOTICE_KEY } from '../../utils/activity';

// Set when the idle sign-out ended the last session; shown once.
function takeIdleNotice() {
  try {
    const flagged = sessionStorage.getItem(IDLE_NOTICE_KEY) === '1';
    if (flagged) sessionStorage.removeItem(IDLE_NOTICE_KEY);
    return flagged;
  } catch {
    return false;
  }
}

export default function Login() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idleNotice] = useState(takeIdleNotice);

  if (!loading && user) {
    const from = location.state?.from;
    return <Navigate to={from || landingFor(user)} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const loggedInUser = await login(employeeId, password);
      const from = location.state?.from;
      navigate(from || landingFor(loggedInUser), { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="sidebar-brand-mark">AE</div>
          <div className="sidebar-brand-text">
            <div className="name">AAPL Platform</div>
            <div className="sub">Consulting Engineers LLC</div>
          </div>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="muted" style={{ marginBottom: 22 }}>Use your Employee ID to continue.</p>
        {idleNotice && <div className="login-error" role="status" style={{ marginBottom: 14 }}>You were signed out because you were inactive for a while. Please sign in again.</div>}
        <form onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="employeeId">Employee ID</label>
          <input
            id="employeeId"
            className="filter-input"
            style={{ width: '100%' }}
            type="text"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="EMP-004"
            autoFocus
            required
          />
          <label className="login-label" htmlFor="password" style={{ marginTop: 14 }}>Password</label>
          <input
            id="password"
            className="filter-input"
            style={{ width: '100%' }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 20 }} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 14, textAlign: 'center' }}>
            Your project hours and activity in this system are recorded. <Link className="link-btn" to="/privacy">See what is recorded and why</Link>.
          </p>
        </form>
      </div>
    </div>
  );
}
