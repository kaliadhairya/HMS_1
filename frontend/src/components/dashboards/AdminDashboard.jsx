import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import PatientAnalyticsModal from '../PatientAnalyticsModal';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsMetric, setAnalyticsMetric] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/admin-ops').then(res => res.data.data).catch(() => null),
      api.get('/dashboard/super-admin').then(res => res.data.data).catch(() => null),
    ]).then(([opsData, saData]) => {
      setData(opsData);
      setAnalyticsData(saData);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  const analyticsKpis = [
    { icon: '📋', label: "Today's Patients", value: analyticsData?.today_patients || 0, color: 'var(--green)', analytics: { kind: 'patients', scope: 'today', title: "Today's Patient Analytics" } },
    { icon: '📊', label: 'This Week', value: analyticsData?.week_patients || 0, color: 'var(--blue)', analytics: { kind: 'patients', scope: 'week', title: 'Weekly Patient Analytics' } },
    { icon: '📈', label: 'This Month', value: analyticsData?.month_patients || 0, color: 'var(--amber)', analytics: { kind: 'patients', scope: 'month', title: 'Monthly Patient Analytics' } },
    { icon: '👥', label: 'Active Users', value: analyticsData?.active_users || 0, color: 'var(--teal)', analytics: { kind: 'users', scope: 'active', title: 'User Access Analytics' } },
  ];

  const kpis = [
    { icon: '💰', label: "Today's Revenue", value: `₹${Number(data?.revenue_today || 0).toLocaleString('en-IN')}`, color: 'var(--green)' },
    { icon: '🛏️', label: 'Bed Occupancy', value: `${data?.bed_occupancy || 0}%`, sub: `${data?.occupied_beds || 0}/${data?.total_beds || 0} beds`, color: data?.bed_occupancy > 80 ? '#ef4444' : 'var(--blue)' },
    { icon: '🏥', label: 'OPD / IPD', value: `${data?.opd_count || 0} / ${data?.ipd_count || 0}`, sub: 'Today', color: 'var(--amber)' },
    { icon: '👨‍⚕️', label: 'Staff on Duty', value: data?.staff_on_duty || 0, color: 'var(--teal)' },
  ];

  const alerts = [
    { icon: '📋', label: 'Pending Discharges', value: data?.pending_discharges || 0, color: data?.pending_discharges > 0 ? 'var(--amber)' : 'var(--green)' },
    { icon: '📦', label: 'Low Stock Medicines', value: data?.low_stock || 0, color: data?.low_stock > 0 ? 'var(--red)' : 'var(--green)' },
    { icon: '📅', label: "Today's Appointments", value: data?.todays_appointments || 0, color: 'var(--blue)' },
  ];

  const quickLinks = [
    { icon: '👥', label: 'Staff Management', path: '/hms/admin/staff', color: '#6366f1' },
    { icon: '🏥', label: 'Patients', path: '/hms/admin/patients', color: '#10b981' },
    { icon: '📅', label: 'Appointments', path: '/hms/appointments', color: '#f59e0b' },
    { icon: '💳', label: 'Billing & Finance', path: '/hms/admin/billing', color: '#ef4444' },
    { icon: '💊', label: 'Pharmacy', path: '/hms/admin/pharmacy', color: '#8b5cf6' },
    { icon: '📝', label: 'Attendance & Leave', path: '/hms/admin/attendance', color: '#14b8a6' },
    { icon: '🛏️', label: 'Bed Management', path: '/hms/admin/bed-management', color: '#0ea5e9' },
  ];

  return (
    <>
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.25)' }}>🏥</span>
              Hospital Admin Dashboard
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Operations Overview — Real-time hospital management insights
            </p>
          </div>
        </div>

        {/* Patient Analytics KPI Cards (clickable, same as SuperAdmin) */}
        {analyticsData && (
          <div className="hms-anim-2" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16, marginBottom: 30,
          }}>
            {analyticsKpis.map((k, i) => (
              <button
                key={k.label}
                type="button"
                className={`hms-stat-card anim-${i + 1}`}
                onClick={() => setAnalyticsMetric(k.analytics)}
                title={`Open ${k.label} analytics`}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 14px 30px -10px rgba(59,130,246,0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = '';
                }}
                style={{
                  borderTop: `4px solid ${k.color}`,
                  padding: 0,
                  display: 'block',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                  width: '100%',
                  minHeight: 136,
                  overflow: 'hidden',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: `${k.color}15`, color: k.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.5rem', flexShrink: 0,
                    }}>
                      {k.icon}
                    </div>
                    <span style={{
                      borderRadius: 999,
                      border: '1px solid rgba(59,130,246,0.22)',
                      background: 'rgba(59,130,246,0.08)',
                      color: '#2563eb',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      lineHeight: 1,
                      padding: '7px 9px',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      Analytics <span style={{ fontSize: '0.82rem' }}>↗</span>
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      lineHeight: 1.25,
                      textTransform: 'uppercase',
                      overflowWrap: 'anywhere',
                    }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4, lineHeight: 1 }}>
                      {k.value}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Operational KPI Cards */}
        <div className="hms-anim-2" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16, marginBottom: 30,
        }}>
          {kpis.map((k, i) => (
            <div key={k.label} className={`hms-stat-card anim-${i + 1}`} style={{
              borderTop: `4px solid ${k.color}`,
              padding: '20px',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: `${k.color}15`, color: k.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem',
              }}>
                {k.icon}
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  {k.label}
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                  {k.value}
                </div>
                {k.sub && <div style={{ fontSize: '0.75rem', color: k.color, marginTop: 4, fontWeight: 600 }}>{k.sub}</div>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, marginBottom: 30 }}>
          {/* Operational Alerts */}
          <div className="card hms-anim-3" style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>⚠️</span> Operational Alerts
            </h3>
            <div style={{ display: 'grid', gap: 12 }}>
              {alerts.map(a => (
                <div key={a.label} style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'transform 0.2s ease', cursor: 'default'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateX(4px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'none'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.2rem', background: 'var(--surface-1)', padding: 8, borderRadius: 8 }}>{a.icon}</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}</span>
                  </div>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: a.color }}>{a.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div className="card hms-anim-4" style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>⚡</span> Quick Access
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {quickLinks.map(ql => (
                <div
                  key={ql.label}
                  onClick={() => navigate(ql.path)}
                  style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: '16px', cursor: 'pointer',
                    transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: 8,
                    borderLeft: `4px solid ${ql.color}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.transform = 'none'; }}
                >
                  <span style={{ fontSize: '1.4rem' }}>{ql.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ql.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Admissions */}
        <div className="card hms-anim-5" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>🛏️</span> Recent Admissions
          </h3>
          <div className="table-wrapper hms-table-anim" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Ward</th>
                  <th>Bed</th>
                  <th>Status</th>
                  <th>Admitted</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_admissions || []).map((adm, i) => (
                  <tr key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                    <td style={{ fontWeight: 600 }}>{adm.PATIENT_NAME || '—'}</td>
                    <td>{adm.WARD_NAME || '—'}</td>
                    <td>{adm.BED_NUMBER || '—'}</td>
                    <td>
                      <span className={`badge ${adm.STATUS === 'Admitted' ? 'badge-green' : adm.STATUS === 'Discharge Pending' ? 'badge-amber' : 'badge-blue'}`} style={{ padding: '4px 10px' }}>
                        {adm.STATUS}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {adm.ADMISSION_DATE ? new Date(adm.ADMISSION_DATE).toLocaleString('en-IN') : '—'}
                    </td>
                  </tr>
                ))}
                {(!data?.recent_admissions || data.recent_admissions.length === 0) && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No recent admissions</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PatientAnalyticsModal
        isOpen={!!analyticsMetric}
        onClose={() => setAnalyticsMetric(null)}
        data={analyticsData}
        metric={analyticsMetric}
      />
    </>
  );
}
