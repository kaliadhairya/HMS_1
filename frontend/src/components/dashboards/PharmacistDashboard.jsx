import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Building2, ChevronRight, CircleAlert, ClipboardList, LayoutGrid, Package, PackageCheck, Pill, Truck, Undo2,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../ui/PageHeader';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// First name, keeping a leading honorific ("Sister Mary", "Dr. Rao").
const firstName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'there';
  if (parts.length > 1 && /^(dr|mr|mrs|ms|miss|sister|sr|prof)\.?$/i.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0];
};

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// A KPI tile that opens a page: same look as a static tile, but a real button.

const QUICK_LINKS = [
  { label: 'Dispense', to: '/pharmacy/dispense', icon: PackageCheck },
  { label: 'Medicines', to: '/pharmacy/medicines', icon: Pill },
  { label: 'Stock', to: '/pharmacy/stock', icon: Package },
  { label: 'Purchase orders', to: '/pharmacy/pos', icon: ClipboardList },
  { label: 'Goods received (GRN)', to: '/pharmacy/grn', icon: Truck },
  { label: 'Suppliers', to: '/pharmacy/suppliers', icon: Building2 },
  { label: 'Returns', to: '/pharmacy/returns', icon: Undo2 },
];

// Pharmacy home: dispensing queue, stock and expiry alerts, and the pharmacy's main pages.
export default function PharmacistDashboard() {
  const { user } = useAuth();
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
          todaysSales: raw.todays_sales || 0,
          // Medicines with 10 or fewer units left, lowest first (the API sends at most 5).
          lowStockItems: raw.low_stock_items || [],
          // Not sent by /dashboard/pharmacist yet; the panel only appears once it is.
          dispenseRatio: raw.dispense_ratio || null,
        });
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const show = (v) => (loading ? '—' : v);
  const lowStock = Number(data?.lowStockCount || 0);
  const expiring = Number(data?.expiringCount || 0);
  const lowItems = data?.lowStockItems || [];
  const ratio = data?.dispenseRatio;

  const tiles = [
    { label: 'Prescriptions to dispense', value: data?.pendingRx || 0, to: '/pharmacy/dispense', action: 'Open the dispense queue' },
    { label: 'Low stock medicines', value: lowStock, to: '/pharmacy/stock', action: 'Open stock', color: lowStock > 0 ? 'var(--amber)' : undefined },
    { label: 'Batches expiring in 30 days', value: expiring, to: '/pharmacy/expiry', action: 'Open expiry alerts', color: expiring > 0 ? 'var(--amber)' : undefined },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user?.name)}`}
        description="Prescriptions waiting to be dispensed, stock levels and expiring batches."
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/pharmacy/reports')}>
              <BarChart3 size={16} aria-hidden="true" /> Reports
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/pharmacy/dispense')}>
              <PackageCheck size={16} aria-hidden="true" /> Open dispense queue
            </button>
          </>
        )}
      />

      {!loading && lowStock > 0 && (
        <div className="alert-strip alert-warning" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span><strong>{lowStock} {lowStock === 1 ? 'medicine is' : 'medicines are'}</strong> at or below 10 units. Raise an indent or purchase order.</span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/pharmacy/stock')}>
            Review stock
          </button>
        </div>
      )}

      <div className="kpi-strip">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            className="panel kpi kpi-button"
            onClick={() => navigate(t.to)}
            aria-label={`${t.label}: ${show(t.value)}. ${t.action}`}
          >
            <div className="kpi-label">{t.label}</div>
            <div className="kpi-value" style={!loading && t.color ? { color: t.color } : undefined}>{show(t.value)}</div>
          </button>
        ))}
        <div className="panel kpi">
          <div className="kpi-label">Sales today</div>
          <div className="kpi-value">{show(inr(data?.todaysSales))}</div>
        </div>
      </div>

      <div className="split-2">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><Package size={16} aria-hidden="true" /> Lowest stock</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/pharmacy/stock')}>
              View stock <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="panel-pad">
            {loading ? <p className="muted">Loading…</p> : lowItems.length === 0 ? (
              <p className="muted">No medicines are running low.</p>
            ) : (
              <table className="mini-table">
                <thead>
                  <tr><th scope="col">Medicine</th><th scope="col" className="text-right">Units in stock</th></tr>
                </thead>
                <tbody>
                  {lowItems.map((item, idx) => {
                    const qty = Number(item.TOTAL_QTY ?? 0);
                    return (
                      <tr key={item.GENERIC_NAME || item.name || idx}>
                        <td>{item.GENERIC_NAME || item.name || '—'}</td>
                        <td className="text-right">
                          {qty <= 0
                            ? <span className="status status-danger">Out of stock</span>
                            : <span className="tabular" style={{ fontWeight: 600 }}>{qty}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="panel panel-pad">
          <h2 className="panel-title"><LayoutGrid size={16} aria-hidden="true" /> Quick actions</h2>
          <ul className="list-rows" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <li key={link.to}>
                  <button type="button" className="list-row" onClick={() => navigate(link.to)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <Icon size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                      {link.label}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {ratio && (
        <section className="panel panel-pad" style={{ marginTop: 16 }}>
          <h2 className="panel-title"><BarChart3 size={16} aria-hidden="true" /> Dispensing by patient type</h2>
          <ul className="bar-list">
            {[['Inpatient (IPD)', Number(ratio.ipd || 0)], ['Outpatient (OPD and OTC)', Number(ratio.opd || 0)]].map(([label, pct]) => (
              <li key={label}>
                <div className="bar-row"><span>{label}</span><strong className="tabular">{pct}%</strong></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
