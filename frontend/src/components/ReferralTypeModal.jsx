import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function ReferralTypeModal({ isOpen, onClose, patient = null }) {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleSelect = (type) => {
    onClose();
    navigate('/doctor/referrals', { 
      state: { 
        type, 
        autoSelectPatient: patient 
      } 
    });
  };

  return (
    <div 
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 99999, animation: 'fadeIn 0.2s ease-out', padding: 20
      }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', width: '100%', maxWidth: 460, borderRadius: 20,
          border: '1px solid var(--border)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', overflow: 'hidden',
          animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)'
        }}
      >
        <div style={{
          padding: '22px 26px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Select Referral Type
          </h2>
          <button 
            onClick={onClose} 
            style={{
              background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer',
              color: 'var(--text-muted)', lineHeight: 1, padding: '4px 8px', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.15s, background 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
          >×</button>
        </div>
        
        <div style={{ padding: '24px 26px 28px' }}>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
            Where would you like to refer this patient?
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Local Referral Option */}
            <button 
              type="button"
              onClick={() => handleSelect('Local')}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                padding: '18px 20px', borderRadius: 16, 
                border: '1.5px solid var(--blue-border, rgba(59,130,246,0.3))',
                background: 'var(--blue-light, rgba(59,130,246,0.08))',
                cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
              onMouseEnter={e => { 
                e.currentTarget.style.background = 'rgba(59,130,246,0.16)'; 
                e.currentTarget.style.borderColor = 'var(--blue, #3b82f6)'; 
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(59,130,246,0.2)';
              }}
              onMouseLeave={e => { 
                e.currentTarget.style.background = 'var(--blue-light, rgba(59,130,246,0.08))'; 
                e.currentTarget.style.borderColor = 'var(--blue-border, rgba(59,130,246,0.3))'; 
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, 
                background: 'rgba(59,130,246,0.18)',
                border: '1px solid rgba(59,130,246,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                flexShrink: 0
              }}>🏥</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--blue, #3b82f6)', marginBottom: 3 }}>Local Referral</div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Refer to another department within HMS Hospital</div>
              </div>
            </button>

            {/* Outside Referral Option */}
            <button 
              type="button"
              onClick={() => handleSelect('Outside')}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                padding: '18px 20px', borderRadius: 16, 
                border: '1.5px solid var(--amber-border, rgba(245,158,11,0.3))',
                background: 'var(--amber-light, rgba(245,158,11,0.08))',
                cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
              onMouseEnter={e => { 
                e.currentTarget.style.background = 'rgba(245,158,11,0.16)'; 
                e.currentTarget.style.borderColor = 'var(--amber, #f59e0b)'; 
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(245,158,11,0.2)';
              }}
              onMouseLeave={e => { 
                e.currentTarget.style.background = 'var(--amber-light, rgba(245,158,11,0.08))'; 
                e.currentTarget.style.borderColor = 'var(--amber-border, rgba(245,158,11,0.3))'; 
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, 
                background: 'rgba(245,158,11,0.18)',
                border: '1px solid rgba(245,158,11,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                flexShrink: 0
              }}>🚑</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--amber, #f59e0b)', marginBottom: 3 }}>Outside Referral</div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Refer to PGI, AIIMS, or other external hospitals</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
