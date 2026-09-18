import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function NurseDashboard() {
  const navigate = useNavigate();
  const [admissions, setAdmissions] = useState([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    fetchNurseData();
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const fetchNurseData = () => {
    setLoading(true);
    Promise.all([
      api.get('/ipd/admissions?status=Active').then(res => setAdmissions(res.data.data || [])).catch(() => {}),
      api.get('/ipd/requests?status=Pending').then(res => setPendingRequests((res.data.data || []).length)).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 16 }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading nurse station...</p>
      </div>
    );
  }

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const dateStr = currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const sidebarStats = [
    { icon: '🛏️', label: 'Active IPD Patients', value: admissions.length, color: '#3b82f6' },
    { icon: '📋', label: 'Pending Admissions', value: pendingRequests, color: '#f59e0b', onClick: () => navigate('/ipd/requests') },
    { icon: '❤️', label: 'Vitals Due (Shift)', value: admissions.length, color: '#ef4444' },
    { icon: '💊', label: 'Pending MAR Tasks', value: admissions.length * 2, color: '#8b5cf6' },
  ];

  return (
    <div style={{ 
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 60px)',
      overflow: 'hidden',
    }}>
      
      {/* ── MAIN GRID ── */}
      <div style={{ 
        display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: '16px', 
        alignItems: 'start', padding: '12px 16px 12px 16px',
        flex: 1, minHeight: 0, overflow: 'hidden',
        width: '100%',
      }}>
        
        {/* ── LEFT COLUMN: Profile & Stats ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: 0 }}>
          
          {/* Nurse Greeting Card */}
          <div className="hms-anim-1" style={{
            flexShrink: 0, background: 'var(--surface)', borderRadius: 16,
            border: '1px solid var(--border)', overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}>
            <div style={{ height: 4, background: 'linear-gradient(90deg, #ec4899, #8b5cf6, #3b82f6)', borderRadius: '16px 16px 0 0' }} />
            <div style={{ padding: '18px 24px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(236,72,153,0.12), rgba(139,92,246,0.12))',
                  border: '1px solid rgba(236,72,153,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem'
                }}>👩‍⚕️</div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-muted)' }}>{greeting}</div>
              </div>
              <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>Nurse Station</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 14px', fontWeight: 500 }}>{dateStr} — Clinical Hub</p>
              
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => navigate('/ipd/beds')} style={{ flex: 1, padding: '9px 12px', fontSize: '0.82rem', fontWeight: 700, borderRadius: 10, background: 'linear-gradient(135deg, #ec4899, #db2777)', border: 'none' }}>
                  Bed Management
                </button>
                <button className="btn btn-outline" onClick={fetchNurseData} style={{ padding: '9px 14px', borderRadius: 10 }}>↻</button>
              </div>
            </div>
          </div>

          {/* Vertical Stats Sidebar */}
          <div className="hms-anim-2" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
            {sidebarStats.map((s, i) => (
              <div key={s.label} className="card" onClick={s.onClick} style={{
                padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16,
                borderLeft: `4px solid ${s.color}`, cursor: s.onClick ? 'pointer' : 'default',
                transition: 'all 0.2s ease', background: 'var(--surface)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
              onMouseEnter={e => s.onClick && (e.currentTarget.style.transform = 'translateX(4px)', e.currentTarget.style.background = `${s.color}05`)}
              onMouseLeave={e => s.onClick && (e.currentTarget.style.transform = 'none', e.currentTarget.style.background = 'var(--surface)')}
              >
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${s.color}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>{s.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>{s.label}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: -2 }}>{s.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER COLUMN: Monitoring Table ── */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card hms-anim-3" style={{ 
            flex: 1, padding: 0, display: 'flex', flexDirection: 'column', 
            overflow: 'hidden', border: '1px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            background: 'var(--surface)',
            borderRadius: 16
          }}>
            <div style={{ 
              padding: '18px 24px', background: 'var(--surface)', 
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1.2rem' }}>📋</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>My Ward Patients</h3>
                <span className="badge badge-teal" style={{ padding: '4px 10px' }}>{admissions.length} Active</span>
              </div>
              <button onClick={() => navigate('/ipd/patients')} className="btn btn-ghost" style={{ fontSize: '0.85rem', fontWeight: 600 }}>View Patient Directory →</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface-2)' }}>
                  <tr>
                    <th style={thS}>PATIENT</th>
                    <th style={thS}>LOCATION</th>
                    <th style={thS}>DOCTOR</th>
                    <th style={thS}>STAY</th>
                    <th style={{...thS, textAlign: 'right', paddingRight: 24}}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {admissions.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '3rem', marginBottom: 16 }}>🏥</div>
                      <h4 style={{ margin: 0 }}>No active patients in your ward</h4>
                      <p style={{ fontSize: '0.85rem', marginTop: 8 }}>Use the IPD Requests to admit new patients.</p>
                    </td></tr>
                  ) : (
                    admissions.map((adm, i) => (
                      <tr key={adm.ID || adm.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'rgba(248,250,252,0.5)' }}>
                        <td style={tdS}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{adm.PATIENT_NAME}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{adm.UHID} • {adm.GENDER?.[0]} / {adm.AGE}Y</div>
                        </td>
                        <td style={tdS}>
                          <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.06)', color: '#3b82f6', fontWeight: 700, fontSize: '0.82rem', display: 'inline-block' }}>
                            {adm.WARD_NAME} / {adm.BED_NUMBER}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Room: {adm.ROOM_NUMBER || '—'}</div>
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Dr. {adm.DOCTOR_NAME}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Primary Consultant</div>
                        </td>
                        <td style={tdS}>
                          <span style={{ 
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 20, 
                            background: (adm.DAYS_ADMITTED || 0) > 5 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                            color: (adm.DAYS_ADMITTED || 0) > 5 ? '#ef4444' : '#10b981',
                            fontWeight: 700, fontSize: '0.8rem'
                          }}>
                            {adm.DAYS_ADMITTED || 0} Days
                          </span>
                        </td>
                        <td style={{ ...tdS, textAlign: 'right', paddingRight: 24 }}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button onClick={() => navigate(`/ipd/patient/${adm.ID || adm.id}`)} className="btn btn-sm btn-outline" style={{ borderRadius: 8, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700 }}>Chart</button>
                            <button onClick={() => navigate('/hms/vitals/entry', { state: { patient: { id: adm.PATIENT_ID, name: adm.PATIENT_NAME, uhid: adm.UHID, age: adm.AGE, gender: adm.GENDER } } })} className="btn btn-sm" style={{ borderRadius: 8, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none' }}>+ Vitals</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Quick Actions & Vitals ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: 0 }}>
          
          {/* Quick Actions Panel */}
          <div className="card hms-anim-4" style={{ padding: 0, overflow: 'hidden', borderRadius: 16, border: '1px solid var(--border)' }}>
            <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1rem' }}>⚡</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Quick Navigation</h3>
            </div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Pending Admissions', icon: '📋', to: '/ipd/requests', color: '#ec4899' },
                { label: 'Bed Management', icon: '🛏️', to: '/ipd/beds', color: '#8b5cf6' },
                { label: 'Patient Directory', icon: '🏥', to: '/ipd/patients', color: '#3b82f6' },
                { label: 'Nursing Roster', icon: '📅', to: '/nurse/dashboard', color: '#10b981' },
              ].map(a => (
                <button key={a.to} onClick={() => navigate(a.to)} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                  borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)',
                  cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left'
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.borderColor = a.color; e.currentTarget.style.background = `${a.color}05`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                >
                  <span style={{ fontSize: '1.2rem', color: a.color }}>{a.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{a.label}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>→</span>
                </button>
              ))}
            </div>
          </div>

          {/* Vitals Queue */}
          <div className="card hms-anim-5" style={{ flex: 1, padding: 0, overflow: 'hidden', borderRadius: 16, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.03)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1rem' }}>💓</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#ef4444' }}>Vitals Due (This Shift)</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {admissions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <div style={{ fontSize: '2rem', opacity: 0.2 }}>🧘</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 10 }}>All vitals recorded ✓</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {admissions.slice(0, 8).map(adm => (
                    <div key={adm.ID || adm.id} style={{
                      padding: '12px', background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{adm.PATIENT_NAME}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{adm.WARD_NAME} / {adm.BED_NUMBER}</div>
                      </div>
                      <button className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: '0.72rem' }}
                        onClick={() => navigate('/hms/vitals/entry', { state: { patient: { id: adm.PATIENT_ID, name: adm.PATIENT_NAME, uhid: adm.UHID, age: adm.AGE, gender: adm.GENDER } } })}>
                        Enter
                      </button>
                    </div>
                  ))}
                  {admissions.length > 8 && <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', padding: 5 }}>+ {admissions.length - 8} more patients</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const thS = {
  padding: '14px 24px', fontSize: '0.72rem', fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
};

const tdS = {
  padding: '16px 24px', fontSize: '0.9rem', verticalAlign: 'middle',
};
