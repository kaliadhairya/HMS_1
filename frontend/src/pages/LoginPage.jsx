import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Stethoscope, Pill, BedDouble, FlaskConical, Eye, EyeOff, CircleAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const MODULES = [
  { icon: Stethoscope, title: 'OPD & consultations', desc: 'Token queue, encounters and e-prescriptions' },
  { icon: Pill, title: 'Pharmacy', desc: 'Stock, batches, dispensing and billing' },
  { icon: BedDouble, title: 'Inpatient wards', desc: 'Admissions, beds, nursing charts and MAR' },
  { icon: FlaskConical, title: 'Laboratory', desc: 'Orders, samples, results and reports' },
];

// Two PQRST complexes on a flat baseline, drawn across the brand panel.
const ECG_PATH = 'M0 44 H110 l10 -5 l9 5 h14 l6 9 l9 -40 l10 52 l8 -16 h18 l12 -7 l12 7 H330 l10 -5 l9 5 h14 l6 9 l9 -40 l10 52 l8 -16 h18 l12 -7 l12 7 H600';

export default function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    document.body.classList.add('login-page');
    return () => document.body.classList.remove('login-page');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    const result = await login(form.username, form.password);
    if (result.success) {
      toast.success('Welcome back!');
      navigate('/dashboard');
    } else if (result.status === 423 && result.lockedUntil) {
      const lockTime = new Date(result.lockedUntil).toLocaleString('en-IN');
      setErr(`Account locked until ${lockTime}. Too many failed attempts.`);
    } else {
      setErr(result.message);
    }
  };

  return (
    <div className="login-shell">
      <aside className="login-brand">
        <div className="login-brand-head">
          <img src="/logo.png" alt="" className="login-logo" />
          <div>
            <div className="login-brand-name">HMS Hospital</div>
            <div className="login-brand-sub">Hospital Management System</div>
          </div>
        </div>

        <h1 className="login-brand-title">One record for every patient, from front desk to discharge.</h1>

        <ul className="login-modules">
          {MODULES.map(({ icon: Icon, title, desc }) => (
            <li key={title}>
              <span className="login-module-icon"><Icon size={20} strokeWidth={1.75} /></span>
              <span>
                <strong>{title}</strong>
                <span>{desc}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* Decorative heartbeat line; a soft pulse travels along it. */}
        <svg className="login-ecg" viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="login-ecg-base" pathLength="1000" d={ECG_PATH} />
          <path className="login-ecg-pulse" pathLength="1000" d={ECG_PATH} />
        </svg>

        <p className="login-brand-foot">
          <ShieldCheck size={16} strokeWidth={1.75} />
          For authorised staff only. All access is audited.
        </p>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="login-lead">Use your staff username and password.</p>

          {err && (
            <div className="login-error" role="alert">
              <CircleAlert size={18} strokeWidth={2} />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                className="form-input login-input"
                autoComplete="username"
                autoFocus
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <div className="login-password">
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  className="form-input login-input"
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  className="login-reveal"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || !form.username || !form.password}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <Link to="/hms/forgot-password" className="login-forgot">Forgot your password?</Link>
        </div>

        <footer className="login-credit">
          Designed, developed and maintained by HMS IT Department · © {new Date().getFullYear()}
        </footer>
      </main>
    </div>
  );
}
