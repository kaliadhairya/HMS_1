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
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 99999, animation: 'hmsFadeIn 0.2s ease-out'
    }}>
      <div style={{
        background: '#fff', width: '100%', maxWidth: 460, borderRadius: 20,
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden',
        animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)'
      }}>
        <div style={{
          padding: '24px 28px', borderBottom: '1px solid var(--border, #e2e8f0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Select Referral Type
          </h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer',
            color: 'var(--text-muted)', lineHeight: 1
          }}>×</button>
        </div>
        
        <div style={{ padding: '28px' }}>
          <p style={{ margin: '0 0 24px', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Where would you like to refer this patient?
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Local Referral Option */}
            <button 
              onClick={() => handleSelect('Local')}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                padding: '20px', borderRadius: 16, border: '2px solid rgba(59,130,246,0.15)',
                background: 'rgba(59,130,246,0.03)', cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.03)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.15)'; }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: 'rgba(59,130,246,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem'
              }}>🏥</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1e3a8a', marginBottom: 4 }}>Local Referral</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Refer to another department within HMS Hospital</div>
              </div>
            </button>

            {/* Outside Referral Option */}
            <button 
              onClick={() => handleSelect('Outside')}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                padding: '20px', borderRadius: 16, border: '2px solid rgba(245,158,11,0.15)',
                background: 'rgba(245,158,11,0.03)', cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.03)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.15)'; }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: 'rgba(245,158,11,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem'
              }}>🚑</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#92400e', marginBottom: 4 }}>Outside Referral</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Refer to PGI, AIIMS, or other external hospitals</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
