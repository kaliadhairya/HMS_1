import { useState, useEffect } from 'react';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';

export default function AdminBillingPage() {
  const [stats, setStats] = useState({});
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/admin-ops').catch(() => ({ data: { data: {} } })),
      api.get('/billing/recent?limit=25').catch(() => ({ data: { data: [] } })),
    ]).then(([sRes, bRes]) => {
      setStats(sRes.data.data);
      setBills(bRes.data.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const kpis = [
    { icon: '💰', label: "Today's Revenue", value: `₹${Number(stats?.revenue_today || 0).toLocaleString('en-IN')}`, color: 'var(--green)' },
    { icon: '📋', label: 'OPD Visits Today', value: stats?.opd_count || 0, color: 'var(--blue)' },
    { icon: '🛏️', label: 'IPD Admitted', value: stats?.ipd_count || 0, color: 'var(--amber)' },
    { icon: '📅', label: 'Appointments', value: stats?.todays_appointments || 0, color: 'var(--teal)' },
  ];

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.25)' }}>💳</span>
              Billing & Finance
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Revenue tracking, outstanding dues, and daily financial summary
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 30 }}>
          {kpis.map((k, i) => (
            <div key={k.label} className={`hms-stat-card anim-${i + 1}`} style={{ borderTop: `4px solid ${k.color}`, padding: '20px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: `${k.color}15`, color: k.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem',
              }}>
                {k.icon}
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{k.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Revenue Summary Cards */}
        <div className="hms-anim-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24, marginBottom: 30 }}>
          <div className="card" style={{ padding: 24, borderTop: '4px solid var(--green)' }}>
            <h3 style={{ marginBottom: 20, fontSize: '1.1rem', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>💰</span> Revenue Breakdown
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'OPD Consultations', value: '₹12,500', pct: 35 },
                { label: 'Lab & Diagnostics', value: '₹8,200', pct: 23 },
                { label: 'Pharmacy Sales', value: '₹9,800', pct: 27 },
                { label: 'IPD / Bed Charges', value: '₹5,500', pct: 15 },
              ].map(r => (
                <div key={r.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: 6 }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{r.label}</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.value}</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${r.pct}%`, background: 'var(--green)', borderRadius: 4, transition: 'width 1s cubic-bezier(0.16,1,0.3,1)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 24, borderTop: '4px solid var(--amber)' }}>
            <h3 style={{ marginBottom: 20, fontSize: '1.1rem', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>📊</span> Outstanding Dues
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { patient: 'Rajesh Kumar', amount: '₹4,500', days: 3 },
                { patient: 'Sunita Devi', amount: '₹12,800', days: 7 },
                { patient: 'Mohd Iqbal', amount: '₹2,200', days: 1 },
                { patient: 'Kavita Singh', amount: '₹7,600', days: 5 },
              ].map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{d.patient}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{d.days} days overdue</div>
                  </div>
                  <span style={{ fontWeight: 800, color: '#ef4444', fontSize: '1.1rem' }}>{d.amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Bills */}
        <div className="card hms-anim-4" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>🧾</span> Recent Bills
          </h3>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Bill #</th><th>Patient</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {bills.length > 0 ? bills.map((b, i) => (
                    <tr key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--blue)' }}>#{b.ID || b.BILL_NUMBER || i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{b.PATIENT_NAME || '—'}</td>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>₹{Number(b.TOTAL_AMOUNT || 0).toLocaleString('en-IN')}</td>
                      <td><span className={`badge ${b.PAYMENT_STATUS === 'Paid' ? 'badge-green' : 'badge-amber'}`} style={{ padding: '4px 10px' }}>{b.PAYMENT_STATUS || 'Pending'}</span></td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{b.BILL_DATE ? new Date(b.BILL_DATE).toLocaleString('en-IN') : '—'}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No recent bills. Revenue data will populate as billing transactions occur.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
