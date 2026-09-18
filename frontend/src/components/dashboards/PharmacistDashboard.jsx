import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function PharmacistDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/dashboard/pharmacist')
      .then(res => {
        const raw = res.data.data || {};
        setData({
          pendingRx: raw.dispense_queue_count || 0,
          lowStockCount: raw.low_stock_count || 0,
          expiringCount: raw.expiring_count || 0,
          returnsToday: raw.returns_today || 0,
          fastMoving: raw.low_stock_items || [],
          dispenseRatio: raw.dispense_ratio || { ipd: 0, opd: 0 },
        });
      })
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

  const cards = [
    { icon: '📝', label: 'Pending Rx', value: data?.pendingRx || 0, color: 'var(--blue)', link: '/pharmacy/dispense' },
    { icon: '📦', label: 'Low Stock Alerts', value: data?.lowStockCount || 0, color: 'var(--amber)', link: '/pharmacy/stock' },
    { icon: '⏰', label: 'Expiring Soon', value: data?.expiringCount || 0, color: 'var(--red)', link: '/pharmacy/expiry' },
    { icon: '↩️', label: 'Returns Today', value: data?.returnsToday || 0, color: 'var(--green-mid)', link: '/pharmacy/returns' },
  ];

  const quickLinks = [
    { icon: '💊', label: 'Medicines', to: '/pharmacy/medicines', color: '#60a5fa' },
    { icon: '🏭', label: 'Suppliers', to: '/pharmacy/suppliers', color: '#818cf8' },
    { icon: '📋', label: 'Purchase Orders', to: '/pharmacy/pos', color: '#c084fc' },
    { icon: '📥', label: 'GRN', to: '/pharmacy/grn', color: '#a78bfa' },
    { icon: '📦', label: 'Stock', to: '/pharmacy/stock', color: '#34d399' },
    { icon: '📝', label: 'Dispense', to: '/pharmacy/dispense', color: '#f472b6' },
  ];

  return (
    <div style={{ padding: '28px 40px', maxWidth: 1600, margin: '0 auto', width: '100%' }}>
      <div className="fade-up" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Pharmacist Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>
            Pharmacy operations & supply chain overview
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/pharmacy/reports')}>📊 Advanced Reports</button>
      </div>

      <div className="fade-up-2" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16, marginBottom: 28,
      }}>
        {cards.map(c => (
          <div key={c.label} className="card" style={{
            padding: '24px 20px', position: 'relative', overflow: 'hidden', cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onClick={() => navigate(c.link)}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: c.color }} />
            <div style={{ fontSize: '1.8rem', marginBottom: 12 }}>{c.icon}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
              {c.label}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, marginBottom: 28 }}>
        {/* Fast Moving Items */}
        <div className="card fade-up-3" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>Fast-Moving Medicines (30d)</h3>
          <table style={{ width: '100%', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>Medicine</th>
                <th style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Units Dispensed</th>
              </tr>
            </thead>
            <tbody>
              {data?.fastMoving?.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>{item.name || item.GENERIC_NAME}</td>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', textAlign: 'right', fontWeight: 600, color: 'var(--green-mid)' }}>
                    {item.sold ?? item.TOTAL_QTY ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* IPD vs OPD Dispense Ratio */}
        <div className="card fade-up-3" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 24 }}>Dispense Ratio: IPD vs OPD</h3>
          {data?.dispenseRatio && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Inpatient (IPD)</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 600, color: 'var(--blue)' }}>{data.dispenseRatio.ipd}%</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Outpatient (OPD/OTC)</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 600, color: 'var(--amber)' }}>{data.dispenseRatio.opd}%</div>
                </div>
              </div>
              <div style={{ width: '100%', height: 12, borderRadius: 6, display: 'flex', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${data.dispenseRatio.ipd}%`, background: 'var(--blue)' }} />
                <div style={{ height: '100%', width: `${data.dispenseRatio.opd}%`, background: 'var(--amber)' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="fade-up-3" style={{ marginBottom: 28 }}>
        <h3 style={{ marginBottom: 16 }}>Quick Launch</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
          {quickLinks.map(link => (
            <div
              key={link.label}
              className="card"
              style={{
                padding: '24px 16px', textAlign: 'center', cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onClick={() => navigate(link.to)}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>{link.icon}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{link.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
