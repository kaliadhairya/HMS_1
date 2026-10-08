import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function IPDBillingListPage() {
  const [admissions, setAdmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/ipd/admissions?status=Active')
      .then(res => setAdmissions(res.data.data || []))
      .catch(() => toast.error('Failed to load admissions'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        {/* Header */}
        <div className="hms-page-header" style={{ marginBottom: 28 }}>
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.25)' }}>💰</span>
              IPD Billing
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Select an admitted patient to manage their billing and charges.
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <div className="spinner" style={{ width: 36, height: 36 }} />
          </div>
        ) : admissions.length === 0 ? (
          <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>🏥</div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>No Active Admissions</h3>
            <p style={{ color: 'var(--text-secondary)' }}>There are currently no admitted patients to bill.</p>
          </div>
        ) : (
          <div className="hms-anim-1" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20,
          }}>
            {admissions.map(adm => {
              const days = adm.DAYS_ADMITTED || Math.max(1, Math.ceil((Date.now() - new Date(adm.ADMISSION_DATE).getTime()) / 86400000));
              return (
                <div key={adm.ID || adm.id} className="card hms-anim-1" style={{
                  padding: 0, overflow: 'hidden', transition: 'all 0.3s ease',
                  border: '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column',
                  boxShadow: 'var(--shadow-sm)',
                  cursor: 'pointer'
                }}
                onClick={() => navigate(`/ipd/billing/${adm.ID || adm.id}`)}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-5px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.borderColor = 'var(--green-light)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ padding: '24px', flex: 1 }}>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                      {/* Avatar */}
                      <div style={{ 
                        width: 64, height: 64, borderRadius: '50%', 
                        background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.8rem', border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                        flexShrink: 0
                      }}>
                        {adm.GENDER === 'Female' ? '👩' : '👨'}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>{adm.PATIENT_NAME}</h3>
                          <span className="badge badge-teal" style={{ fontSize: '0.65rem' }}>Day {days}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8 }}>
                          <span>{adm.UHID}</span>
                          <span style={{ opacity: 0.3 }}>•</span>
                          <span>{adm.ADMISSION_ID_FORMATTED}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ 
                      marginTop: 20, padding: '16px', background: 'var(--surface-2)', borderRadius: 12,
                      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px 10px',
                      border: '1px solid var(--border)'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Location</div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: 2 }}>
                          {adm.WARD_NAME || 'Ward'} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>•</span> Bed {adm.BED_NUMBER || '-'}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>Room: {adm.ROOM_NUMBER || '-'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Duration</div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: 2 }}>{days} Days</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>Since {adm.ADMISSION_DATE ? new Date(adm.ADMISSION_DATE).toLocaleDateString('en-IN') : '-'}</div>
                      </div>
                      <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Primary Physician</div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.9rem' }}>👨‍⚕️</span> {adm.DOCTOR_NAME || 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '0 24px 24px' }}>
                    <Link
                      to={`/ipd/billing/${adm.ID || adm.id}`}
                      className="btn btn-primary"
                      style={{ 
                        width: '100%', textAlign: 'center', fontWeight: 700, display: 'flex', 
                        alignItems: 'center', justifyContent: 'center', gap: 10,
                        textDecoration: 'none', padding: '12px 0', borderRadius: 10,
                        background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none',
                        boxShadow: '0 4px 12px rgba(16,185,129,0.2)'
                      }}
                    >
                      💰 Manage Billing
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
