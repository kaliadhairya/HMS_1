import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

function StatCard({ icon, label, value, color, onClick, disabled, delay }) {
  return (
    <div
      className={`hms-stat-card hms-anim-${delay}`}
      onClick={disabled ? undefined : onClick}
      style={{
        borderLeft: `4px solid ${color}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        filter: disabled ? 'grayscale(0.5)' : 'none',
      }}
    >
      {/* Background glow */}
      <div style={{
        position: 'absolute', top: -30, right: -30,
        width: 90, height: 90, borderRadius: '50%',
        background: `${color}10`,
        pointerEvents: 'none',
      }} />
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: `${color}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.4rem', marginBottom: 12,
        border: `1px solid ${color}25`,
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: '0.68rem', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        fontWeight: 600, marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.5rem', fontWeight: 800,
        color: 'var(--text-primary)',
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

function SecondaryCard({ icon, label, value, color, onClick, delay }) {
  return (
    <div
      className={`hms-stat-card hms-anim-${delay}`}
      onClick={onClick}
      style={{
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 16,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{
        fontSize: '1.3rem',
        background: `${color}15`,
        padding: 10, borderRadius: 10,
        border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{
          fontSize: '0.68rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
        }}>
          {label}
        </div>
        <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

export default function ReceptionistDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [unpaid, setUnpaid] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/receptionist').then(r => setData(r.data.data)).catch(() => {}),
      api.get('/billing/opd/unpaid-today').then(r => setUnpaid(r.data.data || [])).catch(() => {}),
      api.get('/receptionist/notifications').then(r => setNotifications((r.data.data || []).filter(n => !n.read))).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 16 }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading command center...</p>
      </div>
    );
  }

  const greeting = currentTime.getHours() < 12 ? 'Good Morning' : currentTime.getHours() < 17 ? 'Good Afternoon' : 'Good Evening';
  const timeStr = currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const majorCards = [
    { icon: '🎫', label: 'Token Queue', value: data?.token_queue || 0, color: '#3b82f6', onClick: null, disabled: true },
    { icon: '📅', label: "Today's Appointments", value: data?.todays_appointments || 0, color: '#10b981', onClick: () => navigate('/receptionist/appointments') },
    { icon: '💳', label: 'Unpaid Bills', value: unpaid.length, color: unpaid.length > 0 ? '#ef4444' : '#f59e0b', onClick: () => navigate('/receptionist/billing') },
    { icon: '🛏️', label: 'Beds Available', value: data?.bed_availability || 0, color: '#8b5cf6', onClick: () => navigate('/receptionist/ipd') },
  ];

  const secondaryCards = [
    { icon: '🚨', label: 'Pending Discharges', value: data?.pending_discharges || 0, color: '#ec4899', onClick: () => navigate('/receptionist/ipd') },
    { icon: '🔔', label: 'Unread Alerts', value: notifications.length, color: '#f59e0b', onClick: () => navigate('/receptionist/notifications') },
    { icon: '🚶', label: 'Walk-in / Booked', value: `${data?.walk_in_count || 0} / ${data?.booked_count || 0}`, color: '#06b6d4' },
  ];

  return (
    <>
      {/* ── Header with greeting ── */}
      <div className="hms-anim-1" style={{
        marginBottom: 28,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(139,92,246,0.2))',
              border: '1px solid rgba(168,85,247,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem',
              animation: 'hmsPulseGlow 3s ease-in-out infinite',
            }}>
              🏥
            </div>
            <div>
              <h1 style={{ margin: 0, lineHeight: 1.1 }}>Front Desk Command Center</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
                {greeting} — {dateStr}
              </p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            padding: '8px 16px', borderRadius: 10,
            background: 'var(--surface)', border: '1px solid var(--border)',
            fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            🕐 {timeStr}
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/hms/patients/new')}
            style={{ position: 'relative', overflow: 'hidden' }}
          >
            + Quick Register
          </button>
          <button className="btn btn-outline" onClick={() => navigate('/hms/appointments/book')}>
            📅 Book Appointment
          </button>
        </div>
      </div>

      {/* ── Major Stat Cards ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 16, marginBottom: 20,
      }}>
        {majorCards.map((c, i) => (
          <StatCard key={c.label} {...c} delay={i + 1} />
        ))}
      </div>

      {/* ── Secondary Cards ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 14, marginBottom: 28,
      }}>
        {secondaryCards.map((c, i) => (
          <SecondaryCard key={c.label} {...c} delay={i + 3} />
        ))}
      </div>

      {/* ── Unpaid Bills (Full Width) ── */}
      <div className="card hms-anim-5" style={{ padding: 0, overflow: 'hidden', marginBottom: 110 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}>
          <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(239,68,68,0.1)', fontSize: '0.9rem',
            }}>
              ⚠️
            </span>
            Unpaid OPD Encounters
          </h3>
          <button className="btn btn-sm btn-outline" onClick={() => navigate('/receptionist/billing')}>
            View All Bills
          </button>
        </div>
        <div style={{ padding: '0' }}>
          {unpaid.length === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center',
              animation: 'hmsScaleIn 0.5s 0.4s ease both',
            }}>
              <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: 8 }}>✅</span>
              <p style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>All Clear!</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>No pending bills for today.</p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr><th>UHID</th><th>Patient</th><th>Doctor</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {unpaid.slice(0, 5).map(u => (
                    <tr key={u.ENCOUNTER_ID}>
                      <td><strong style={{ color: 'var(--green)' }}>{u.UHID}</strong></td>
                      <td style={{ fontWeight: 500 }}>{u.NAME}</td>
                      <td>{u.DOCTOR_NAME}</td>
                      <td>
                        <button className="btn btn-sm btn-primary" onClick={() => navigate(`/billing/opd/${u.ENCOUNTER_ID}`)}>
                          Generate Bill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
