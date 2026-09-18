import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import toast from 'react-hot-toast';

export default function ReceptionistBillingPage() {
  const navigate = useNavigate();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('unpaid');

  useEffect(() => {
    api.get('/receptionist/billing-summary')
      .then(res => setBilling(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statsCards = billing ? [
    { icon: '💰', label: "Today's Collection", value: `₹ ${billing.todays_collection?.toLocaleString()}`, color: '#10b981' },
    { icon: '⏳', label: 'Pending Amount', value: `₹ ${billing.pending_total?.toLocaleString()}`, color: '#ef4444' },
    { icon: '📄', label: 'Unpaid Encounters', value: billing.unpaid_today?.length || 0, color: '#f59e0b' },
    { icon: '✅', label: 'Receipts Issued', value: billing.recent_payments?.length || 0, color: '#3b82f6' },
  ] : [];

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">💳</span>
              Billing & Payments
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Generate OPD bills, collect payments, and issue receipts.
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 80, gap: 12 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading billing data...</span>
          </div>
        ) : billing && (
          <>
            {/* Stats Cards */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: 16, marginBottom: 24,
            }}>
              {statsCards.map((c, i) => (
                <div key={c.label} className={`hms-stat-card hms-anim-${i + 1}`}
                  style={{ borderLeft: `4px solid ${c.color}` }}
                >
                  <div style={{ position: 'absolute', top: -20, right: -20, width: 70, height: 70, borderRadius: '50%', background: `${c.color}08`, pointerEvents: 'none' }} />
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `${c.color}15`, border: `1px solid ${c.color}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.3rem', marginBottom: 10,
                  }}>
                    {c.icon}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 5 }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs + Table */}
            <div className="card hms-anim-5" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
                <button
                  className={`hms-tab-btn ${tab === 'unpaid' ? 'active' : ''}`}
                  onClick={() => setTab('unpaid')}
                  style={{ borderRadius: 0, borderRight: '1px solid var(--border)' }}
                >
                  ⏳ Unpaid Encounters ({billing.unpaid_today?.length || 0})
                </button>
                <button
                  className={`hms-tab-btn ${tab === 'recent' ? 'active' : ''}`}
                  onClick={() => setTab('recent')}
                  style={{ borderRadius: 0 }}
                >
                  ✅ Recent Payments ({billing.recent_payments?.length || 0})
                </button>
              </div>

              <div style={{ padding: 0 }}>
                {tab === 'unpaid' && (
                  (billing.unpaid_today || []).length === 0 ? (
                    <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
                      <span className="empty-icon">🎉</span>
                      <h3>All Bills Cleared!</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No pending OPD bills for today.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                      <table>
                        <thead>
                          <tr><th>UHID</th><th>Patient</th><th>Doctor</th><th>Dept</th><th>Amount</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                          {(billing.unpaid_today || []).map((u, idx) => (
                            <tr key={idx}>
                              <td><strong style={{ color: 'var(--green)' }}>{u.uhid}</strong></td>
                              <td style={{ fontWeight: 500 }}>{u.patient}</td>
                              <td>{u.doctor}</td>
                              <td>{u.department}</td>
                              <td><span style={{ fontWeight: 700, color: '#ef4444' }}>₹ {u.amount}</span></td>
                              <td>
                                <button className="btn btn-sm btn-primary" onClick={() => navigate(`/billing/opd/${u.encounter_id}`)}>
                                  Open Billing
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {tab === 'recent' && (
                  (billing.recent_payments || []).length === 0 ? (
                    <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
                      <span className="empty-icon">📭</span>
                      <h3>No Recent Payments</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No payments recorded yet.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                      <table>
                        <thead>
                          <tr><th>Receipt #</th><th>UHID</th><th>Patient</th><th>Amount</th><th>Method</th><th>Date/Time</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                          {(billing.recent_payments || []).map((p, idx) => {
                            const methodColors = {
                              Cash: { bg: 'rgba(16,185,129,0.1)', color: '#059669', border: 'rgba(16,185,129,0.25)' },
                              UPI: { bg: 'rgba(59,130,246,0.1)', color: '#2563eb', border: 'rgba(59,130,246,0.25)' },
                              Card: { bg: 'rgba(139,92,246,0.1)', color: '#7c3aed', border: 'rgba(139,92,246,0.25)' },
                            };
                            const mc = methodColors[p.method] || methodColors.Cash;
                            return (
                              <tr key={idx}>
                                <td><strong>{p.receipt_no}</strong></td>
                                <td>{p.uhid}</td>
                                <td style={{ fontWeight: 500 }}>{p.patient}</td>
                                <td><span style={{ fontWeight: 700, color: '#10b981' }}>₹ {p.amount}</span></td>
                                <td>
                                  <span style={{
                                    padding: '3px 10px', borderRadius: 20,
                                    fontSize: '0.7rem', fontWeight: 700,
                                    background: mc.bg, color: mc.color,
                                    border: `1px solid ${mc.border}`,
                                  }}>
                                    {p.method}
                                  </span>
                                </td>
                                <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.date} {p.time}</td>
                                <td>
                                  <button
                                    className="btn btn-sm btn-outline"
                                    onClick={() => {
                                      navigator.clipboard.writeText(String(p.receipt_no || ''));
                                      toast.success('Receipt number copied.');
                                    }}
                                  >
                                    📋 Copy
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
