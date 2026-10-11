import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, FileDown, Hourglass, PackageCheck, PackageX, RefreshCw, TrendingUp } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const PERIODS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']];
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function PharmacyReportsPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(1);

  const load = (d) => {
    setLoading(true);
    api.get(`/pharmacist_lms/reports?days=${d}`)
      .then(res => setReport(res.data.data))
      .catch((err) => {
        console.error(err);
        setReport(null);
        toast.error('Could not load pharmacy reports');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(days); }, [days]);

  const show = (v) => (loading || !report ? '—' : v);
  const periodLabel = (PERIODS.find(([d]) => d === days) || [])[1] || `${days} days`;
  const alerts = Number(report?.stockAlerts || 0);

  const topColumns = useMemo(() => [
    { id: 'name', header: 'Medicine', accessorFn: (r) => r.name || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'units', header: 'Units issued', accessorFn: (r) => Number(r.units || 0), meta: { width: 140, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> },
    { id: 'amount', header: 'Value', accessorFn: (r) => Number(r.amount || 0), meta: { width: 140, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span> },
  ], []);

  const lowColumns = useMemo(() => [
    { id: 'name', header: 'Medicine', accessorFn: (r) => r.name || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    {
      id: 'stock', header: 'In stock', accessorFn: (r) => Number(r.stock || 0), meta: { width: 140, align: 'right' },
      cell: ({ getValue }) => (getValue() <= 0 ? <span className="status status-danger">Out of stock</span> : <span className="tabular" style={{ fontWeight: 600, color: 'var(--amber)' }}>{getValue()}</span>),
    },
  ], []);

  const expiryColumns = useMemo(() => [
    { id: 'name', header: 'Medicine', accessorFn: (r) => r.name || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'batch', header: 'Batch', accessorFn: (r) => r.batchNumber || '', meta: { width: 150 }, cell: ({ getValue }) => <span className="mono">{getValue()}</span> },
    {
      id: 'expiry', header: 'Expires', accessorFn: (r) => new Date(r.expiryDate).getTime() || 0, meta: { width: 190 },
      cell: ({ row }) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span className="tabular">{fmtDate(row.original.expiryDate)}</span>
          {row.original.expired && <span className="status status-danger">Expired</span>}
        </span>
      ),
    },
    { id: 'qty', header: 'Qty', accessorFn: (r) => Number(r.quantity || 0), meta: { width: 90, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> },
  ], []);

  const slowColumns = useMemo(() => [
    {
      id: 'name', header: 'Medicine', accessorFn: (r) => r.name || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span>,
    },
    {
      id: 'stock', header: 'Current stock', accessorFn: (r) => Number(r.stock || 0), meta: { width: 160, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{getValue()} units</span>,
    },
    {
      id: 'lastMoved', header: 'Last dispensed or sold', accessorFn: (r) => r.lastMoved || '', meta: { width: 200 },
      cell: ({ getValue }) => <span className="status status-warning">{getValue() ? fmtDate(getValue()) : 'Never'}</span>,
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Pharmacy reports"
          description="Dispensing and counter sales for the period, stock value, and medicines that need attention."
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" onClick={() => load(days)}>
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </button>
              <button type="button" className="btn btn-secondary btn-md" disabled title="PDF export is not available yet">
                <FileDown size={16} aria-hidden="true" /> Export PDF
              </button>
            </>
          )}
        />

        <div className="toolbar" style={{ padding: 0, border: 0, marginBottom: 12 }}>
          <div className="segmented" role="tablist" aria-label="Report period">
            {PERIODS.map(([d, label]) => (
              <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'is-active' : ''} onClick={() => setDays(d)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="kpi-strip">
          <div className="panel kpi">
            <div className="kpi-label">Dispensed ({periodLabel})</div>
            <div className="kpi-value" data-testid="kpi-dispensed">{show(inr(report?.dispensed?.amount))}</div>
            <div className="muted">{show(`${report?.dispensed?.prescriptions ?? 0} prescriptions · ${report?.dispensed?.units ?? 0} units`)}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Counter sales ({periodLabel})</div>
            <div className="kpi-value" data-testid="kpi-otc">{show(inr(report?.otc?.amount))}</div>
            <div className="muted">{show(`${report?.otc?.sales ?? 0} sales · ${report?.otc?.units ?? 0} units`)}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Inventory value at cost</div>
            <div className="kpi-value" data-testid="kpi-inventory">{show(inr(report?.inventoryValue))}</div>
            <div className="muted">{show(`${inr(report?.inventoryValueMrp)} at MRP · unexpired stock`)}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Active stock alerts</div>
            <div className="kpi-value" data-testid="kpi-alerts" style={{ color: alerts > 0 ? 'var(--red)' : undefined }}>{show(alerts)}</div>
            <div className="muted">{show(`${report?.lowStockCount ?? 0} low stock · ${report?.expiringCount ?? 0} expiring · ${report?.expiredCount ?? 0} expired`)}</div>
          </div>
        </div>

        <div className="split-2">
          <section className="panel" aria-label="Top medicines">
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><TrendingUp size={16} aria-hidden="true" /> Top medicines ({periodLabel})</h2>
            </div>
            <DataTable
              columns={topColumns}
              data={report?.topMedicines || []}
              loading={loading}
              getRowId={(r, i) => String(r.id ?? i)}
              pageSize={10}
              initialSorting={[{ id: 'units', desc: true }]}
              empty={<EmptyState icon={TrendingUp} title="Nothing issued" description="No medicines were dispensed or sold in this period." />}
            />
          </section>

          <section className="panel" aria-label="Low stock">
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><PackageX size={16} aria-hidden="true" /> Low stock ({report?.lowStockThreshold ?? 10} units or fewer)</h2>
            </div>
            <DataTable
              columns={lowColumns}
              data={report?.lowStock || []}
              loading={loading}
              getRowId={(r, i) => String(r.id ?? i)}
              pageSize={10}
              initialSorting={[{ id: 'stock', desc: false }]}
              empty={<EmptyState icon={PackageCheck} title="No low stock" description="Every active medicine has more than the threshold in stock." />}
            />
          </section>
        </div>

        <section className="panel" aria-label="Expiring soon" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><CalendarClock size={16} aria-hidden="true" /> Expired or expiring within 30 days</h2>
          </div>
          <DataTable
            columns={expiryColumns}
            data={report?.expiringSoon || []}
            loading={loading}
            getRowId={(r, i) => String(r.batchId ?? i)}
            pageSize={10}
            initialSorting={[{ id: 'expiry', desc: false }]}
            empty={<EmptyState icon={CalendarClock} title="Nothing expiring" description="No batch with stock expires within 30 days." />}
          />
        </section>

        <section className="panel" aria-label="Slow-moving inventory" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><Hourglass size={16} aria-hidden="true" /> Slow-moving inventory (nothing issued in 30 days)</h2>
          </div>
          <DataTable
            columns={slowColumns}
            data={report?.slowMoving || []}
            loading={loading}
            getRowId={(r, i) => String(r.id ?? i)}
            pageSize={15}
            initialSorting={[{ id: 'stock', desc: true }]}
            empty={(
              <EmptyState
                icon={PackageCheck}
                title={report ? 'No slow-moving stock' : 'Report unavailable'}
                description={report ? 'Every medicine in stock has been dispensed or sold in the last 30 days.' : 'The report could not be loaded. Refresh the page to try again.'}
              />
            )}
          />
        </section>
      </main>
    </>
  );
}
