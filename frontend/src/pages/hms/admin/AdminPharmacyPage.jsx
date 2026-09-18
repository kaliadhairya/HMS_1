import { useState, useEffect } from 'react';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';

export default function AdminPharmacyPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/pharmacist')
      .then(r => setData(r.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (<><Navbar /><div className="page-wrapper"><div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div></div></>);

  const kpis = [
    { icon: '💊', label: 'Dispense Queue', value: data?.dispense_queue_count || 0, color: 'var(--blue)' },
    { icon: '📦', label: 'Low Stock Items', value: data?.low_stock_count || 0, color: data?.low_stock_count > 0 ? '#ef4444' : 'var(--green)' },
    { icon: '⏰', label: 'Expiring (30 days)', value: data?.expiring_count || 0, color: data?.expiring_count > 0 ? '#fbbf24' : 'var(--green)' },
    { icon: '💰', label: "Today's Sales", value: `₹${Number(data?.todays_sales || 0).toLocaleString('en-IN')}`, color: 'var(--green)' },
  ];

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}>💊</span>
              Pharmacy Overview
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Inventory oversight, low stock alerts, sales data — view & approve mode (no dispensing)
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 30 }}>
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

        {/* Low Stock Alerts */}
        <div className="card hms-anim-3" style={{ padding: 24, borderTop: '4px solid #ef4444', marginBottom: 30 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span> Low Stock Alerts
          </h3>
          {(data?.low_stock_items || []).length > 0 ? (
            <div className="table-wrapper hms-table-anim">
              <table>
                <thead><tr><th>Medicine</th><th>Stock Qty</th><th>Status</th></tr></thead>
                <tbody>
                  {data.low_stock_items.map((item, i) => (
                    <tr key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.GENERIC_NAME}</td>
                      <td>
                        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: item.TOTAL_QTY <= 0 ? '#ef4444' : '#fbbf24' }}>
                          {item.TOTAL_QTY}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${item.TOTAL_QTY <= 0 ? 'badge-red' : 'badge-amber'}`} style={{ padding: '4px 10px' }}>
                          {item.TOTAL_QTY <= 0 ? 'OUT OF STOCK' : 'LOW'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, background: 'var(--surface-2)', borderRadius: 12, border: '1px dashed var(--border)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12, filter: 'drop-shadow(0 4px 6px rgba(16,185,129,0.3))' }}>✅</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>All medicines are well-stocked</div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>No immediate procurement required</p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="hms-anim-4">
          <h3 style={{ marginBottom: 16, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>⚡</span> Pharmacy Management
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {[
              { icon: '📋', label: 'View Medicine Master', desc: 'All registered medicines', path: '/pharmacy/medicines', color: '#3b82f6' },
              { icon: '📦', label: 'Check Stock Levels', desc: 'Batch-wise stock details', path: '/pharmacy/stock', color: '#10b981' },
              { icon: '📥', label: 'GRN / Procurement', desc: 'Purchase orders & receipts', path: '/pharmacy/grn', color: '#f59e0b' },
              { icon: '⏰', label: 'Expiry Alerts', desc: 'Medicines expiring soon', path: '/pharmacy/expiry', color: '#ef4444' },
            ].map(ql => (
              <a key={ql.label} href={ql.path} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ padding: 20, cursor: 'pointer', transition: 'all 0.2s', borderLeft: `4px solid ${ql.color}`, height: '100%' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span style={{ fontSize: '2rem', background: `${ql.color}15`, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>{ql.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{ql.label}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{ql.desc}</div>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
