import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import PatientAnalyticsModal from '../PatientAnalyticsModal';

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsMetric, setAnalyticsMetric] = useState(null);

  useEffect(() => {
    api.get('/dashboard/super-admin')
      .then(res => setData(res.data.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  const kpis = [
    { icon: '📋', label: "Today's Patients", value: data?.today_patients || 0, color: 'var(--green)', analytics: { kind: 'patients', scope: 'today', title: "Today's Patient Analytics" } },
    { icon: '📊', label: 'This Week', value: data?.week_patients || 0, color: 'var(--blue)', analytics: { kind: 'patients', scope: 'week', title: 'Weekly Patient Analytics' } },
    { icon: '📈', label: 'This Month', value: data?.month_patients || 0, color: 'var(--amber)', analytics: { kind: 'patients', scope: 'month', title: 'Monthly Patient Analytics' } },
    { icon: '👥', label: 'Active Users', value: data?.active_users || 0, color: 'var(--teal)', analytics: { kind: 'users', scope: 'active', title: 'User Access Analytics' } },
  ];

  const alerts = [
    { icon: '🚨', label: 'Failed Logins Today', value: data?.alerts?.failed_logins_today || 0, color: 'var(--red)' },
    { icon: '📦', label: 'Low Stock Items', value: data?.alerts?.low_stock_count || 0, color: 'var(--amber)' },
    { icon: '⚠️', label: 'Critical Labs', value: data?.alerts?.critical_lab_count || 0, color: 'var(--red)' },
  ];

  return (
    <>
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}>🛡️</span>
              Super Admin Dashboard
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Hospital Management System — System-wide Overview & Controls
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="hms-anim-2" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16, marginBottom: 30,
        }}>
          {kpis.map((k, i) => (
            <button
              key={k.label}
              type="button"
              className={`hms-stat-card anim-${i + 1}`}
              onClick={() => setAnalyticsMetric(k.analytics)}
              title={`Open ${k.label} analytics`}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 14px 30px -10px rgba(139,92,246,0.4)';
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
                    border: '1px solid rgba(139,92,246,0.22)',
                    background: 'rgba(139,92,246,0.08)',
                    color: '#7c3aed',
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, marginBottom: 30 }}>
          {/* System Alerts */}
          <div className="card hms-anim-3" style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>🚨</span> System Alerts
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
              <span style={{ fontSize: '1.2rem' }}>⚡</span> Admin Controls
            </h3>
            <div style={{ display: 'grid', gap: 12 }}>
              <button className="hms-action-btn" onClick={() => navigate('/hms/admin/users')}>
                <span>👥 User Management</span>
                <span className="arrow">→</span>
              </button>
              <button className="hms-action-btn" onClick={() => navigate('/reports')}>
                <span>📊 Reports & Analytics</span>
                <span className="arrow">→</span>
              </button>
              <button className="hms-action-btn" onClick={() => navigate('/admin/settings')}>
                <span>⚙️ System Settings</span>
                <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </div>

        {/* Recent Audit Log */}
        <div className="card hms-anim-5" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>📋</span> Recent Audit Log
          </h3>
          <div className="table-wrapper hms-table-anim" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Action</th>
                  <th>Module</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_audit || []).map((log, i) => (
                  <tr key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                    <td style={{ fontWeight: 600 }}>{log.user}</td>
                    <td>
                      <span className={`badge ${log.action === 'LOGIN' ? 'badge-green' : log.action === 'LOGIN_FAILED' ? 'badge-red' : 'badge-blue'}`} style={{ padding: '4px 10px' }}>
                        {log.action}
                      </span>
                    </td>
                    <td>{log.module}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '—'}
                    </td>
                  </tr>
                ))}
                {(!data?.recent_audit || data.recent_audit.length === 0) && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No audit logs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PatientAnalyticsModal
        isOpen={!!analyticsMetric}
        onClose={() => setAnalyticsMetric(null)}
        data={data}
        metric={analyticsMetric}
      />
    </>
  );
}
