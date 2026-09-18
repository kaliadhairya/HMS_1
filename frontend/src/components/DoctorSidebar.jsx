import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_LINKS = [
  { to: '/doctor/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/hms/patients/new', label: 'Registration', icon: '📝' },
  { to: '/hms/appointments', label: 'Consultation Queue', icon: '👥' },
  { to: '/hms/patients/search', label: 'Patient Search', icon: '🔍' },
  { to: '/doctor/prescriptions', label: 'Prescription Hub', icon: '💊' },
  { to: '/doctor/referrals', label: 'Referrals Hub', icon: '🔄' },
  { to: '/doctor/rest-forms', label: 'Rest Forms Hub', icon: '🛏️' },
  { to: '/ipd/patients', label: 'IPD Hub', icon: '🏥' },
  { to: '/ipd/requests', label: 'IPD Requests', icon: '📥' },
];

export default function DoctorSidebar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const timeStr = currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div style={{
      position: 'fixed',
      top: 72, /* Below the navbar */
      left: 0, bottom: 0,
      width: 260,
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(180deg, #0c1f1d 0%, #0a1a2e 100%)',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      zIndex: 99,
      overflow: 'hidden',
    }}>

      {/* ── Doctor Profile Card ── */}
      <div style={{
        padding: '20px 20px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(180deg, rgba(13,148,136,0.12) 0%, transparent 100%)',
        flexShrink: 0,
      }}>
        {/* Gradient accent bar */}
        <div style={{
          height: 3, borderRadius: 4, marginBottom: 16,
          background: 'linear-gradient(90deg, #0d9488, #3b82f6, #8b5cf6)',
        }} />

        <div style={{ marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: 'rgba(255,255,255,0.45)', marginBottom: 3,
              fontStyle: 'italic',
            }}>
              {greeting}
            </div>
            <div style={{
              fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.2,
              color: '#ffffff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user?.name || 'Doctor'}
            </div>
          </div>
        </div>

        <div style={{
          fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', fontWeight: 500,
          marginBottom: 14, paddingLeft: 2,
        }}>
          📅 {dateStr}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/hms/appointments/book')}
            style={{
              flex: 1, padding: '9px 14px', fontSize: '0.78rem', fontWeight: 700,
              borderRadius: 10, color: '#fff', cursor: 'pointer',
              background: 'linear-gradient(135deg, #0d9488, #0f766e)',
              border: '1px solid rgba(16,185,129,0.3)',
              boxShadow: '0 2px 10px rgba(13,148,136,0.3)',
              transition: 'all 0.2s', fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(13,148,136,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(13,148,136,0.3)'; }}
          >
            + Follow-up
          </button>
          <button onClick={() => window.location.reload()}
            style={{
              padding: '9px 14px', fontSize: '0.78rem', fontWeight: 600,
              borderRadius: 10, cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.7)',
              transition: 'all 0.2s', fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Nav Links ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 10px', flex: 1, overflow: 'auto' }}>
        {NAV_LINKS.map((link) => {
          const isActive = location.pathname === link.to ||
            (link.to !== '/doctor/dashboard' && location.pathname.startsWith(link.to));
          return (
            <button
              key={link.to}
              onClick={() => navigate(link.to)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 14px', borderRadius: 10,
                border: 'none',
                background: isActive
                  ? 'linear-gradient(135deg, rgba(13,148,136,0.2), rgba(59,130,246,0.1))'
                  : 'transparent',
                color: isActive ? '#34d399' : 'rgba(255,255,255,0.55)',
                fontSize: '0.88rem', fontWeight: isActive ? 700 : 500,
                cursor: 'pointer', transition: 'all 0.2s',
                textAlign: 'left', fontFamily: 'inherit',
                borderLeft: isActive ? '3px solid #10b981' : '3px solid transparent',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                }
              }}
            >
              <span style={{ fontSize: '1.1rem', width: 24, textAlign: 'center', flexShrink: 0 }}>{link.icon}</span>
              {link.label}
            </button>
          );
        })}
      </div>

      {/* Live Time + Credit */}
      <div style={{ padding: '14px 18px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '5px 12px', borderRadius: 18,
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)',
          fontSize: '0.74rem', color: '#34d399', fontWeight: 600,
          fontVariantNumeric: 'tabular-nums', marginBottom: 10,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#10b981',
            boxShadow: '0 0 0 3px rgba(16,185,129,0.25)',
            animation: 'hmsPulseGlow 2s ease-in-out infinite',
          }} />
          {timeStr} · Live
        </div>
        <div style={{ fontSize: '0.6rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.02em', lineHeight: 1.5 }}>
          Designed, developed, and maintained by<br/>HMS IT Department © 2026.
        </div>
      </div>
    </div>
  );
}
