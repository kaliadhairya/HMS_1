import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';

const quickActions = [
  { label: 'Register New Patient', icon: '📝', to: '/hms/patients/new', color: '#10b981' },
  { label: 'Generate OPD Token', icon: '🎫', to: '/hms/opd/token', color: '#f59e0b', disabled: true },
  { label: 'Book Appointment', icon: '📅', to: '/hms/appointments/book', color: '#3b82f6' },
  { label: 'Collect Payment', icon: '💳', to: '/receptionist/billing', color: '#8b5cf6' },
  { label: 'New IPD Admission', icon: '🛏️', to: '/receptionist/ipd', color: '#ec4899' },
  { label: 'Issue Visitor Pass', icon: '👥', to: '/receptionist/visitors', color: '#06b6d4' },
];

export default function ReceptionistQuickActionsDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('receptionist-role');
    return () => document.body.classList.remove('receptionist-role');
  }, []);

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsOpen(false), 300);
  };

  return (
    <>
      {/* CSS Keyframes injected once */}
      <style>{`
        @keyframes recFabPulse {
          0%, 100% { box-shadow: 0 4px 24px rgba(16,185,129,0.25), 0 0 0 0 rgba(16,185,129,0.3); }
          50% { box-shadow: 0 4px 24px rgba(16,185,129,0.25), 0 0 0 8px rgba(16,185,129,0); }
        }
        @keyframes recFabSlideIn {
          from { opacity: 0; transform: translateX(20px) scale(0.92); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes recFabPanelIn {
          from { opacity: 0; transform: translateY(10px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .rec-fab-action-item:hover {
          background: rgba(16,185,129,0.06) !important;
          transform: translateX(4px);
        }
        .rec-fab-action-item:active {
          transform: translateX(2px) scale(0.98);
        }
        .rec-fab-action-item:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          text-decoration: line-through;
        }
        .rec-fab-action-item:disabled:hover {
          background: transparent !important;
          transform: none;
        }
      `}</style>

      <div
        ref={containerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 12,
        }}
      >
        {/* ── Expanded Quick Action Panel ── */}
        {isOpen && (
          <div style={{
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 16,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
            padding: '8px 0',
            width: 260,
            animation: 'recFabPanelIn 0.25s cubic-bezier(0.16,1,0.3,1) both',
          }}>
            {/* Panel Header */}
            <div style={{
              padding: '12px 20px 10px',
              fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 8,
              borderBottom: '1px solid rgba(0,0,0,0.05)',
              marginBottom: 4,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: 6,
                background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem',
              }}>⚡</span>
              Quick Actions
            </div>

            {/* Action Items */}
            {quickActions.map((a, i) => (
              <button
                key={a.label}
                className="rec-fab-action-item"
                disabled={a.disabled}
                onClick={() => { if (!a.disabled) { setIsOpen(false); navigate(a.to); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 20px',
                  width: '100%', textAlign: 'left',
                  border: 'none', background: 'transparent',
                  fontSize: '0.88rem', fontWeight: 600, color: a.disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                  cursor: a.disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  animation: `recFabSlideIn 0.3s cubic-bezier(0.16,1,0.3,1) ${i * 0.04}s both`,
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: `${a.color}12`, border: `1px solid ${a.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', flexShrink: 0,
                  filter: a.disabled ? 'grayscale(1)' : 'none',
                }}>{a.icon}</span>
                {a.label}
              </button>
            ))}

            {/* Credit line */}
            <div style={{
              borderTop: '1px solid rgba(0,0,0,0.05)', marginTop: 4,
              padding: '10px 20px 6px', textAlign: 'center',
              fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-muted)',
              letterSpacing: '0.02em',
            }}>
              HMS IT Department © 2026
            </div>
          </div>
        )}

        {/* ── Floating Action Button ── */}
        <button
          onClick={() => setIsOpen(prev => !prev)}
          onMouseEnter={handleMouseEnter}
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: isOpen
              ? 'linear-gradient(135deg, #ef4444, #f97316)'
              : 'linear-gradient(135deg, #10b981, #059669)',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(16,185,129,0.25)',
            animation: !isOpen ? 'recFabPulse 3s ease-in-out infinite' : 'none',
            transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
            transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
          title={isOpen ? 'Close Quick Actions' : 'Quick Actions'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}
