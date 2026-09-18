import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

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
  const strLabel = ['Weak', 'Fair', 'Good', 'Strong'][str - 1] || '';
  const strColor = ['var(--red)', 'var(--amber)', 'var(--blue)', 'var(--green)'][str - 1] || 'var(--border)';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');

    if (form.newPassword !== form.confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }
    if (str < 4) {
      setErr('Password must have min 8 chars, 1 uppercase, 1 number, and 1 special character.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success(data.message || 'Password changed!');
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

  const renderField = (label, key, toggleKey) => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="form-input"
          type={showFields[toggleKey] ? 'text' : 'password'}
          value={form[key]}
          onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
          required
          style={{ paddingRight: 44 }}
        />
        <button
          type="button"
          onClick={() => setShowFields(s => ({ ...s, [toggleKey]: !s[toggleKey] }))}
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: '1rem', padding: 4,
          }}
        >{showFields[toggleKey] ? '🙈' : '👁️'}</button>
      </div>
    </div>
  );

  return (
    <>
      <Navbar />
      <div className="page-wrapper">
        <div className="fade-up" style={{ maxWidth: 460, margin: '0 auto' }}>
          <div className="card" style={{ padding: 32 }}>
            <h2 style={{ marginBottom: 8 }}>🔐 Change Password</h2>
            {user?.first_login === 'Y' && (
              <div className="alert alert-success" style={{ marginBottom: 20 }}>
                <span>👋</span> Welcome! Please set a new password to continue.
              </div>
            )}
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 24 }}>
              Choose a strong password to secure your account.
            </p>

            {err && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <span>⚠️</span> {err}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {renderField('Current Password', 'currentPassword', 'current')}
              {renderField('New Password', 'newPassword', 'new')}

              {form.newPassword && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'var(--surface-3)' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${(str / 4) * 100}%`,
                      background: strColor,
                      transition: 'all 0.3s',
                    }} />
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: strColor }}>{strLabel}</span>
                </div>
              )}

              {renderField('Confirm New Password', 'confirmPassword', 'confirm')}

              <button
                type="submit"
                className="btn btn-primary btn-lg btn-full"
                disabled={loading}
                style={{ marginTop: 8 }}
              >
                {loading ? (
                  <><div className="spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Updating…</>
                ) : 'Update Password →'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
