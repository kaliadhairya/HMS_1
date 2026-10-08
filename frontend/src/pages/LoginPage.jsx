import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/* ────── Animated floating particles (medical icons) ────── */
const PARTICLES = [
  { icon: '💉', size: 28, x: 8, y: 12, dur: 18, delay: 0 },
  { icon: '🩺', size: 32, x: 82, y: 8, dur: 22, delay: 2 },
  { icon: '💊', size: 24, x: 15, y: 72, dur: 20, delay: 4 },
  { icon: '🏥', size: 30, x: 75, y: 78, dur: 19, delay: 1 },
  { icon: '❤️', size: 22, x: 50, y: 20, dur: 24, delay: 3 },
  { icon: '🧬', size: 26, x: 30, y: 88, dur: 21, delay: 5 },
  { icon: '🔬', size: 24, x: 65, y: 45, dur: 23, delay: 2.5 },
  { icon: '🩸', size: 20, x: 90, y: 60, dur: 17, delay: 1.5 },
];

/* ────── Heartbeat line SVG path ────── */
function HeartbeatLine() {
  return (
    <svg
      viewBox="0 0 600 60"
      style={{
        position: 'absolute',
        bottom: 80,
        left: 0,
        width: '100%',
        height: 60,
        opacity: 0.15,
        pointerEvents: 'none',
      }}
    >
      <path
        d="M0,30 L120,30 L140,10 L160,50 L180,5 L200,55 L220,30 L600,30"
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
        strokeLinecap="round"
        style={{
          strokeDasharray: 800,
          strokeDashoffset: 800,
          animation: 'heartbeatDraw 3s ease-in-out forwards',
          animationDelay: '1s',
        }}
      />
    </svg>
  );
}

/* ────── Feature card component ────── */
function FeatureCard({ icon, title, desc, delay }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '14px 18px',
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(8px)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.1)',
        cursor: 'default',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: `loginSlideUp 0.6s ${delay}s cubic-bezier(0.16, 1, 0.3, 1) both`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
        e.currentTarget.style.borderColor = 'rgba(52,211,153,0.4)';
        e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(16,185,129,0.15)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
        e.currentTarget.style.transform = 'translateY(0) scale(1)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: 'rgba(52,211,153,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.15rem', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ color: 'rgba(200,216,232,0.6)', fontSize: '0.75rem', lineHeight: 1.4 }}>
          {desc}
        </div>
      </div>
    </div>
  );
}

/* ────── Login Page ────── */
export default function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [mounted, setMounted] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const formRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('login-page');
    // Trigger mount animation
    requestAnimationFrame(() => setMounted(true));
    return () => document.body.classList.remove('login-page');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    const result = await login(form.username, form.password);
    if (result.success) {
      toast.success('Welcome back!');
      const role = result.user?.role;
      if (role === 'super_admin' || role === 'admin') {
        navigate('/admin/dashboard');
      } else if (role === 'doctor') {
        navigate('/hms/patients/new');
      } else if (role === 'lab_technician') {
        navigate('/dashboard');
      } else {
        navigate(`/${role}/dashboard`);
      }
    } else {
      if (result.status === 423 && result.lockedUntil) {
        const lockTime = new Date(result.lockedUntil).toLocaleString('en-IN');
        setErr(`Account locked until ${lockTime}. Too many failed attempts.`);
      } else {
        setErr(result.message);
      }
    }
  };

  return (
    <>
      {/* Inject animations */}
      <style>{`
        @keyframes loginSlideUp {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes loginFadeScale {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes loginFloat {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          25%      { transform: translateY(-15px) rotate(5deg); }
          50%      { transform: translateY(-8px) rotate(-3deg); }
          75%      { transform: translateY(-20px) rotate(3deg); }
        }
        @keyframes heartbeatDraw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes loginPulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(16,185,129,0.2), 0 0 60px rgba(16,185,129,0.1); }
          50%      { box-shadow: 0 0 30px rgba(16,185,129,0.35), 0 0 80px rgba(16,185,129,0.15); }
        }
        @keyframes loginGradientShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes loginShimmer {
          0%   { left: -100%; }
          100% { left: 200%; }
        }
        @keyframes loginTypewriter {
          from { width: 0; }
          to   { width: 100%; }
        }
        @keyframes loginBlink {
          50% { border-color: transparent; }
        }
        @keyframes loginOrbitSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .login-input-wrapper {
          position: relative;
          transition: all 0.3s ease;
        }
        .login-input-wrapper.focused {
          transform: translateY(-1px);
        }
        .login-input-wrapper .form-input {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
          border: 1.5px solid var(--border) !important;
        }
        .login-input-wrapper.focused .form-input {
          border-color: #10b981 !important;
          box-shadow: 0 0 0 3px rgba(16,185,129,0.15), 0 4px 12px rgba(16,185,129,0.1) !important;
        }
        .login-submit-btn {
          position: relative;
          overflow: hidden;
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
          background: linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%) !important;
          background-size: 200% 200% !important;
          animation: loginGradientShift 3s ease infinite !important;
        }
        .login-submit-btn:hover:not(:disabled) {
          transform: translateY(-2px) !important;
          box-shadow: 0 8px 25px rgba(16,185,129,0.4), 0 3px 10px rgba(0,0,0,0.1) !important;
        }
        .login-submit-btn:active:not(:disabled) {
          transform: translateY(0px) !important;
        }
        .login-submit-btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 60%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
          animation: loginShimmer 3s ease-in-out infinite;
        }
      `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}>

        {/* ── Left Panel ─────────────────────────────── */}
        <div style={{
          flex: '0 0 50%',
          background: 'linear-gradient(160deg, #0a1a2e 0%, #0c2d4a 30%, #064e3b 60%, #065f46 80%, #0a2f1f 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '48px 56px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Animated gradient overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at 20% 20%, rgba(16,185,129,0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(52,211,153,0.12) 0%, transparent 55%), radial-gradient(ellipse at 50% 50%, rgba(6,95,70,0.25) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Orbiting ring */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 500, height: 500,
            marginTop: -250, marginLeft: -250,
            border: '1px solid rgba(52,211,153,0.06)',
            borderRadius: '50%',
            animation: 'loginOrbitSpin 60s linear infinite',
            pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', top: -4, left: '50%',
              width: 8, height: 8, borderRadius: '50%',
              background: 'rgba(52,211,153,0.4)',
            }} />
          </div>

          {/* Floating medical particles */}
          {PARTICLES.map((p, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${p.x}%`,
              top: `${p.y}%`,
              fontSize: p.size,
              opacity: 0.12,
              animation: `loginFloat ${p.dur}s ${p.delay}s ease-in-out infinite`,
              pointerEvents: 'none',
              filter: 'blur(0.5px)',
            }}>
              {p.icon}
            </div>
          ))}

          {/* Heartbeat ECG line */}
          <HeartbeatLine />

          {/* Content */}
          <div style={{ position: 'relative', zIndex: 2 }}>
            {/* Logo + Hospital name */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              marginBottom: 48,
              animation: 'loginSlideUp 0.7s 0.1s cubic-bezier(0.16, 1, 0.3, 1) both',
            }}>
              <div style={{
                position: 'relative',
                animation: 'loginPulseGlow 3s ease-in-out infinite',
                borderRadius: 18,
              }}>
                <img
                  src="/logo.png"
                  alt="HMS Hospital Logo"
                  style={{
                    width: 78, height: 78,
                    objectFit: 'contain',
                    background: '#fff',
                    borderRadius: 18,
                    padding: 6,
                  }}
                />
              </div>
              <div>
                <div style={{
                  color: '#fff', fontWeight: 800,
                  fontSize: '1.5rem', letterSpacing: '0.02em', lineHeight: 1.1,
                }}>
                  HMS Hospital
                </div>
                <div style={{
                  color: 'rgba(52,211,153,0.8)',
                  fontSize: '0.85rem',
                  marginTop: 4,
                  fontWeight: 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                }}>
                  Healthcare Excellence
                </div>
              </div>
            </div>

            {/* Headline */}
            <div style={{
              animation: 'loginSlideUp 0.7s 0.25s cubic-bezier(0.16, 1, 0.3, 1) both',
            }}>
              <h1 style={{
                fontFamily: 'var(--font-display)',
                color: '#fff',
                fontSize: 'clamp(2rem, 3.2vw, 2.8rem)',
                lineHeight: 1.15,
                marginBottom: 10,
                fontWeight: 700,
              }}>
                Hospital{' '}
                <span style={{
                  background: 'linear-gradient(135deg, #6ee7b7, #34d399, #10b981)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  Management
                </span>
                <br />System
              </h1>
              <p style={{
                color: 'rgba(200,216,232,0.6)',
                fontSize: '0.92rem',
                lineHeight: 1.7,
                maxWidth: 380,
                marginBottom: 36,
              }}>
                A unified digital platform for OPD consultations, patient records, prescriptions, pharmacy, IPD management, and more.
              </p>
            </div>

            {/* Feature cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FeatureCard
                icon="🩺"
                title="OPD & Consultations"
                desc="Token queue, encounters & e-prescriptions"
                delay={0.5}
              />
              <FeatureCard
                icon="💊"
                title="Pharmacy"
                desc="Stock, dispensing & billing"
                delay={0.6}
              />
              <FeatureCard
                icon="🛏️"
                title="IPD Wards"
                desc="Admissions, beds & nursing"
                delay={0.7}
              />
              <FeatureCard
                icon="🔬"
                title="Lab & Reports"
                desc="Samples, tests & result entry"
                delay={0.8}
              />
            </div>
          </div>

          {/* Bottom badge */}
          <div style={{
            position: 'absolute', bottom: 28, left: 56,
            display: 'flex', alignItems: 'center', gap: 8,
            animation: 'loginSlideUp 0.7s 1s cubic-bezier(0.16, 1, 0.3, 1) both',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 8px rgba(16,185,129,0.6)',
              animation: 'pulse-ring 2s infinite',
            }} />
            <span style={{ color: 'rgba(200,216,232,0.5)', fontSize: '0.72rem', letterSpacing: '0.06em' }}>
              SYSTEM ONLINE • v2.0
            </span>
          </div>
        </div>

        {/* ── Right Panel (Form) ─────────────────────────── */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 32px',
          background: 'var(--bg)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Subtle decorative glow */}
          <div style={{
            position: 'absolute', top: -120, right: -120,
            width: 350, height: 350, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: -80, left: -80,
            width: 250, height: 250, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(37,99,235,0.05) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div
            ref={formRef}
            style={{
              width: '100%', maxWidth: 400,
              animation: 'loginFadeScale 0.7s 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
            }}
          >
            {/* Authorized badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 16px',
              background: 'var(--green-light)',
              border: '1px solid var(--green-border)',
              borderRadius: 24,
              marginBottom: 30,
            }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--green-mid)',
                animation: 'pulse-ring 2s infinite',
              }} />
              <span style={{
                fontSize: '0.72rem', fontWeight: 700,
                color: 'var(--green)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                🔒 Authorized Access Only
              </span>
            </div>

            {/* Sign in heading */}
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.85rem',
              color: 'var(--text-primary)',
              marginBottom: 6,
              fontWeight: 700,
            }}>
              Welcome Back
            </h2>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: '0.88rem',
              marginBottom: 32,
              lineHeight: 1.5,
            }}>
              Sign in to access the Hospital Management System.
            </p>

            {/* Error */}
            {err && (
              <div style={{
                padding: '12px 16px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 10,
                marginBottom: 20,
                display: 'flex', alignItems: 'center', gap: 10,
                animation: 'loginSlideUp 0.3s ease both',
              }}>
                <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                <span style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 500 }}>{err}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="form-group">
                <label className="form-label" style={{
                  fontSize: '0.78rem', fontWeight: 600,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  marginBottom: 6, display: 'block',
                  color: focusedField === 'username' ? '#10b981' : undefined,
                  transition: 'color 0.3s',
                }}>
                  Username
                </label>
                <div className={`login-input-wrapper ${focusedField === 'username' ? 'focused' : ''}`}>
                  <input
                    className="form-input"
                    type="text"
                    id="login-username"
                    autoComplete="username"
                    placeholder="Enter your username"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    onFocus={() => setFocusedField('username')}
                    onBlur={() => setFocusedField(null)}
                    required
                    style={{ fontSize: '0.95rem', padding: '13px 16px' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{
                  fontSize: '0.78rem', fontWeight: 600,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  marginBottom: 6, display: 'block',
                  color: focusedField === 'password' ? '#10b981' : undefined,
                  transition: 'color 0.3s',
                }}>
                  Password
                </label>
                <div className={`login-input-wrapper ${focusedField === 'password' ? 'focused' : ''}`} style={{ position: 'relative' }}>
                  <input
                    className="form-input"
                    type={showPass ? 'text' : 'password'}
                    id="login-password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                    style={{ paddingRight: 48, fontSize: '0.95rem', padding: '13px 48px 13px 16px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: '1.05rem', padding: 4,
                      lineHeight: 1,
                      transition: 'transform 0.2s, color 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#10b981';
                      e.currentTarget.style.transform = 'translateY(-50%) scale(1.15)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--text-muted)';
                      e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                    }}
                  >
                    {showPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-lg btn-full login-submit-btn"
                id="login-submit-btn"
                disabled={loading}
                style={{
                  marginTop: 4,
                  padding: '14px 20px',
                  fontSize: '1rem',
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                  borderRadius: 12,
                }}
              >
                {loading
                  ? <><div className="spinner" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Signing in…</>
                  : <>Sign In <span style={{ marginLeft: 6, transition: 'transform 0.3s', display: 'inline-block' }}>→</span></>
                }
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: 22 }}>
              <Link to="/hms/forgot-password" style={{
                fontSize: '0.85rem', color: 'var(--blue)',
                textDecoration: 'none', fontWeight: 500,
                transition: 'color 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.color = '#10b981'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--blue)'}
              >
                Forgot your password?
              </Link>
            </div>

            {/* Copyright - Below forgot password */}
            <div style={{
              textAlign: 'center',
              marginTop: 32,
              padding: '14px 20px',
              borderTop: '1px solid var(--border)',
              animation: 'loginSlideUp 0.5s 1.2s cubic-bezier(0.16, 1, 0.3, 1) both',
            }}>
              <div style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                letterSpacing: '0.03em',
                lineHeight: 1.6,
              }}>
                Designed, Developed & Maintained by
              </div>
              <div style={{
                fontSize: '0.78rem',
                fontWeight: 800,
                color: 'var(--text-secondary)',
                letterSpacing: '0.04em',
                marginTop: 3,
              }}>
                HMS — IT Department
              </div>
              <div style={{
                fontSize: '0.65rem',
                color: 'var(--text-muted)',
                marginTop: 4,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                © 2026 All Rights Reserved
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
