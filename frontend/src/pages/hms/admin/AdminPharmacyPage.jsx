import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Boxes, CalendarClock, ChevronRight, ClipboardList, PackageCheck, Pill, TriangleAlert } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import api from '../../../api/axios';

const QUICK_LINKS = [
  { icon: ClipboardList, label: 'Medicine master', desc: 'All registered medicines', path: '/pharmacy/medicines' },
  { icon: Boxes, label: 'Stock levels', desc: 'Batch-wise stock details', path: '/pharmacy/stock' },
  { icon: PackageCheck, label: 'Goods receipt', desc: 'Purchase orders and receipts', path: '/pharmacy/grn' },
  { icon: CalendarClock, label: 'Expiry alerts', desc: 'Medicines expiring soon', path: '/pharmacy/expiry' },
];

export default function AdminPharmacyPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/pharmacist')
      .then(r => setData(r.data.data))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load the pharmacy overview');
      })
      .finally(() => setLoading(false));
  }, []);

  const lowStock = Number(data?.low_stock_count || 0);
  const expiring = Number(data?.expiring_count || 0);
  const lowItems = data?.low_stock_items || [];
  const show = (v) => (loading ? '—' : v);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Pharmacy overview"
          description="Stock levels, expiry and sales across the pharmacy. View only; dispensing happens in the pharmacy module."
        />

        <div className="kpi-strip">
          <div className="panel kpi">
            <div className="kpi-label">Dispense queue</div>
            <div className="kpi-value">{show(Number(data?.dispense_queue_count || 0))}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Low stock items</div>
            <div className="kpi-value" style={{ color: lowStock > 0 ? 'var(--red)' : undefined }}>{show(lowStock)}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Expiring in 30 days</div>
            <div className="kpi-value" style={{ color: expiring > 0 ? 'var(--amber)' : undefined }}>{show(expiring)}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Sales today</div>
            <div className="kpi-value">{show(`₹${Number(data?.todays_sales || 0).toLocaleString('en-IN')}`)}</div>
          </div>
        </div>

        <div className="split-2">
          <section className="panel panel-pad">
            <h2 className="panel-title"><TriangleAlert size={16} aria-hidden="true" /> Low stock</h2>
            {loading ? <p className="muted">Loading…</p> : lowItems.length === 0 ? (
              <p className="muted">All medicines are above the low-stock level. No procurement needed right now.</p>
            ) : (
              <table className="mini-table">
                <thead><tr><th>Medicine</th><th className="text-right">In stock</th><th>Status</th></tr></thead>
                <tbody>
                  {lowItems.map((item, i) => {
                    const qty = Number(item.TOTAL_QTY || 0);
                    return (
                      <tr key={`${item.GENERIC_NAME}-${i}`}>
                        <td className="cell-primary">{item.GENERIC_NAME}</td>
                        <td className="text-right tabular">{qty}</td>
                        <td>
                          <span className={`status ${qty <= 0 ? 'status-danger' : 'status-warning'}`}>{qty <= 0 ? 'Out of stock' : 'Low'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel panel-pad">
            <h2 className="panel-title"><Pill size={16} aria-hidden="true" /> Pharmacy management</h2>
            <ul className="list-rows">
              {QUICK_LINKS.map((ql) => {
                const Icon = ql.icon;
                return (
                  <li key={ql.path}>
                    <button type="button" className="list-row" onClick={() => navigate(ql.path)}>
                      <span className="cell-person">
                        <span className="cell-avatar" aria-hidden="true"><Icon size={16} /></span>
                        <span className="cell-stack">
                          <span className="cell-primary">{ql.label}</span>
                          <span className="cell-secondary">{ql.desc}</span>
                        </span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
