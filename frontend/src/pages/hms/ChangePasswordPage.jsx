import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, CircleAlert, Info } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import PageHeader from '../../components/ui/PageHeader';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const STRENGTH = [
  { label: 'Weak', color: 'var(--red)' },
  { label: 'Fair', color: 'var(--amber)' },
  { label: 'Good', color: 'var(--primary)' },
  { label: 'Strong', color: 'var(--success)' },
];

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showFields, setShowFields] = useState({ current: false, new: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const strength = (pw) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) s++;
    return s;
  };

  const str = strength(form.newPassword);
  const strLabel = STRENGTH[str - 1]?.label || '';
  const strColor = STRENGTH[str - 1]?.color || 'var(--border)';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');

    if (form.newPassword !== form.confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }
    if (str < 4) {
      setErr('Password must have at least 8 characters, 1 uppercase letter, 1 number and 1 special character.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success(data.message || 'Password changed');
      // Update first_login in localStorage
      const storedUser = JSON.parse(localStorage.getItem('lab_user') || '{}');
      storedUser.first_login = 'N';
      localStorage.setItem('lab_user', JSON.stringify(storedUser));

      // Redirect based on role
      const role = user?.role;
      if (role === 'lab_technician') navigate('/dashboard');
      else if (role === 'admin') navigate('/admin');
      else navigate('/hms/dashboard');
    } catch (error) {
      setErr(error.response?.data?.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  const renderField = (label, key, toggleKey, autoComplete) => {
    const id = `cp-${key}`;
    const shown = showFields[toggleKey];
    return (
      <div className="form-group">
        <label className="form-label" htmlFor={id}>{label}</label>
        <div style={{ position: 'relative' }}>
          <input
            id={id}
            className="form-input"
            type={shown ? 'text' : 'password'}
            autoComplete={autoComplete}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            required
            style={{ width: '100%', paddingRight: 44 }}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowFields((s) => ({ ...s, [toggleKey]: !s[toggleKey] }))}
            aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={shown}
            style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32 }}
          >
            {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <PageHeader title="Change password" description="Choose a strong password to secure your account." />

          <section className="panel panel-pad">
            {user?.first_login === 'Y' && (
              <div className="alert-strip alert-info" role="status">
                <Info size={16} aria-hidden="true" /> Welcome. Set a new password to continue.
              </div>
            )}

            {err && (
              <div className="alert-strip alert-danger" role="alert">
                <CircleAlert size={16} aria-hidden="true" /> {err}
              </div>
            )}

            <form onSubmit={handleSubmit} className="stack">
              {renderField('Current password', 'currentPassword', 'current', 'current-password')}
              {renderField('New password', 'newPassword', 'new', 'new-password')}

              {form.newPassword && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="bar-track" style={{ flex: 1 }}>
                    <div className="bar-fill" style={{ width: `${(str / 4) * 100}%`, background: strColor }} />
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: strColor }} aria-live="polite">
                    {strLabel ? `Strength: ${strLabel}` : ''}
                  </span>
                </div>
              )}
              <p className="form-hint" style={{ marginTop: -8 }}>
                At least 8 characters, with an uppercase letter, a number and a special character.
              </p>

              {renderField('Confirm new password', 'confirmPassword', 'confirm', 'new-password')}

              <button type="submit" className="btn btn-primary btn-md" disabled={loading} style={{ justifyContent: 'center' }}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
