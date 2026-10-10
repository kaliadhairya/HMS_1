import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { KeyRound, CircleAlert, ArrowLeft, Eye, EyeOff } from 'lucide-react';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Step 1
  const [usernameOrPhone, setUsernameOrPhone] = useState('');

  // Step 2
  const [otp, setOtp] = useState('');
  const [username, setUsername] = useState('');
  const [countdown, setCountdown] = useState(600); // 10 min in seconds
  const [resetToken, setResetToken] = useState('');

  // Step 3
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Countdown timer for OTP
  useEffect(() => {
    if (step !== 2) return;
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const handleStep1 = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { usernameOrPhone });
      toast.success('OTP sent!');
      setUsername(usernameOrPhone);
      setCountdown(600);
      setStep(2);
      // DEV: show OTP in console
      if (data.otp) console.log('DEV OTP:', data.otp);
    } catch (error) {
      setErr(error.response?.data?.message || 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleStep2 = async (e) => {
    e.preventDefault();
    setErr('');
    if (countdown <= 0) {
      setErr('OTP has expired. Please request a new one.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-otp', { username, otp });
      setResetToken(data.resetToken);
      toast.success('OTP verified!');
      setStep(3);
    } catch (error) {
      setErr(error.response?.data?.message || 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleStep3 = async (e) => {
    e.preventDefault();
    setErr('');
    if (newPassword !== confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }
    const strongRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!strongRegex.test(newPassword)) {
      setErr('Password must be min 8 chars with 1 uppercase, 1 number, and 1 special character.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { resetToken, newPassword });
      toast.success('Password reset successfully!');
      navigate('/login');
    } catch (error) {
      setErr(error.response?.data?.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <section className="panel" style={{ padding: 32 }}>
          {/* Progress */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }} role="progressbar" aria-label="Reset progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
            {[1, 2, 3].map(s => (
              <div key={s} style={{
                flex: 1, height: 4, borderRadius: 4,
                background: step >= s ? 'var(--primary)' : 'var(--surface-3)',
                transition: 'all 0.3s',
              }} />
            ))}
          </div>

          <h1 style={{ marginBottom: 8, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={20} aria-hidden="true" /> Reset password</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 24 }}>
            {step === 1 && 'Enter your username or registered phone number.'}
            {step === 2 && 'Enter the 6-digit OTP sent to your contact.'}
            {step === 3 && 'Set your new password.'}
          </p>

          {err && (
            <div className="alert-strip alert-danger" role="alert">
              <CircleAlert size={16} aria-hidden="true" /> {err}
            </div>
          )}

          {/* Step 1 */}
          {step === 1 && (
            <form onSubmit={handleStep1} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="fp-user">Username or phone</label>
                <input
                  id="fp-user"
                  className="form-input"
                  type="text"
                  placeholder="e.g. labtech1 or 9876543210"
                  value={usernameOrPhone}
                  onChange={(e) => setUsernameOrPhone(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </form>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <form onSubmit={handleStep2} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="fp-otp">6-digit OTP</label>
                <input
                  id="fp-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="form-input"
                  type="text"
                  maxLength={6}
                  placeholder="Enter OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  style={{ fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.5em' }}
                />
              </div>
              <div style={{
                textAlign: 'center', fontSize: '0.85rem',
                color: countdown > 60 ? 'var(--text-secondary)' : 'var(--red)',
                fontWeight: 600,
              }}>
                <span role="timer" aria-live="off">OTP expires in {formatTime(countdown)}</span>
              </div>
              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={loading || countdown <= 0}>
                {loading ? 'Verifying…' : 'Verify OTP'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-full"
                onClick={() => { setStep(1); setErr(''); }}
              >
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            </form>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <form onSubmit={handleStep3} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="fp-new">New password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="fp-new"
                    autoComplete="new-password"
                    className="form-input"
                    type={showPass ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    aria-pressed={showPass}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: '1rem',
                    }}
                  >{showPass ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="fp-confirm">Confirm new password</label>
                <input
                  id="fp-confirm"
                  autoComplete="new-password"
                  className="form-input"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={loading}>
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to="/login" style={{ fontSize: '0.88rem', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
