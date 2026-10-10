import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Wallet, CircleAlert } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import api from '../../../api/axios';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ymd = (d) => d.toISOString().slice(0, 10);
const STATUS_TONE = { Paid: 'success', 'Partially Paid': 'warning', Pending: 'warning', Cancelled: 'neutral' };

const PERIODS = {
  today: { label: 'Today', start: () => new Date() },
  week: { label: 'Last 7 days', start: () => new Date(Date.now() - 6 * 864e5) },
  month: { label: 'This month', start: () => { const d = new Date(); d.setDate(1); return d; } },
};

export default function AdminBillingPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('month');
  const [revenue, setRevenue] = useState(null);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const start = ymd(PERIODS[period].start());
    const end = ymd(new Date());
    Promise.all([
      api.get(`/reports/revenue?start_date=${start}&end_date=${end}`).catch(() => null),
      api.get('/dashboard/admin-ops').catch(() => null),
      api.get('/billing/recent?limit=50').catch(() => null),
    ]).then(([rev, ops, recent]) => {
      setRevenue(rev?.data?.data || null);
      setTodayRevenue(ops?.data?.data?.revenue_today || 0);
      setBills(recent?.data?.data || []);
    }).finally(() => setLoading(false));
  }, [period]);

  const totals = revenue?.totals || {};
  const byDept = useMemo(() => {
    const rows = (revenue?.byDepartment || []).map((d) => ({ name: d.DEPARTMENT || 'Unassigned', value: Number(d.REVENUE || 0) }));
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows.sort((a, b) => b.value - a.value).map((r) => ({ ...r, pct: (r.value / max) * 100 }));
  }, [revenue]);
  const byMode = (revenue?.byMode || []).map((m) => ({ name: m.PAYMENT_MODE || 'Other', value: Number(m.TOTAL || 0) }));
  const unpaid = bills.filter((b) => b.STATUS !== 'Paid' && b.STATUS !== 'Cancelled');

  const columns = useMemo(() => [
    {
      id: 'bill', header: 'Bill', accessorFn: (b) => b.BILL_NUMBER || '', meta: { width: 170 },
      cell: ({ row }) => <span className="mono">{row.original.BILL_NUMBER || `#${row.original.ID}`}</span>,
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (b) => b.PATIENT_NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.PATIENT_NAME || '—'}</span>
          <span className="cell-secondary mono">{row.original.UHID}</span>
        </span>
      ),
    },
    { id: 'type', header: 'Type', accessorFn: (b) => b.BILL_TYPE || '', meta: { width: 90 } },
    {
      id: 'amount', header: 'Amount', accessorFn: (b) => Number(b.NET_PAYABLE || 0), meta: { width: 130, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (b) => b.STATUS || '', meta: { width: 140 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'date', header: 'Date', accessorFn: (b) => (b.CREATED_AT ? new Date(b.CREATED_AT).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="tabular">{fmtDate(row.original.CREATED_AT)}</span>,
    },
    { id: 'by', header: 'Created by', accessorFn: (b) => b.CREATED_BY_NAME || '', meta: { width: 170 } },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Billing & finance"
          description="Revenue, collections and outstanding bills across OPD and IPD."
          actions={(
            <div className="segmented" role="tablist" aria-label="Period">
              {Object.entries(PERIODS).map(([key, p]) => (
                <button key={key} type="button" role="tab" aria-selected={period === key} className={period === key ? 'is-active' : ''} onClick={() => setPeriod(key)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Billed · {PERIODS[period].label.toLowerCase()}</div><div className="kpi-value">{inr(totals.TOTAL_PAYABLE)}</div></div>
          <div className="panel kpi"><div className="kpi-label">Collected</div><div className="kpi-value">{inr(totals.TOTAL_COLLECTED)}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Outstanding</div>
            <div className="kpi-value" style={{ color: Number(totals.OUTSTANDING) > 0 ? 'var(--amber)' : undefined }}>{inr(totals.OUTSTANDING)}</div>
          </div>
          <div className="panel kpi"><div className="kpi-label">Collected today</div><div className="kpi-value">{inr(todayRevenue)}</div></div>
        </div>

        <div className="split-2">
          <section className="panel panel-pad">
            <h2 className="panel-title"><Wallet size={16} aria-hidden="true" /> Revenue by department</h2>
            {byDept.length === 0 ? <p className="muted">No billed revenue in this period.</p> : (
              <ul className="bar-list">
                {byDept.map((d) => (
                  <li key={d.name}>
                    <div className="bar-row"><span>{d.name}</span><strong className="tabular">{inr(d.value)}</strong></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${d.pct}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
            {byMode.length > 0 && (
              <>
                <h3 className="panel-subtitle">Collections by payment mode</h3>
                <div className="chip-row">
                  {byMode.map((m) => <span key={m.name} className="status status-neutral">{m.name}: {inr(m.value)}</span>)}
                </div>
              </>
            )}
          </section>

          <section className="panel panel-pad">
            <h2 className="panel-title"><CircleAlert size={16} aria-hidden="true" /> Unpaid bills</h2>
            {unpaid.length === 0 ? <p className="muted">No unpaid bills among the latest 50.</p> : (
              <ul className="list-rows">
                {unpaid.slice(0, 6).map((b) => (
                  <li key={b.ID}>
                    <button type="button" className="list-row" onClick={() => navigate(b.BILL_TYPE === 'OPD' && b.ENCOUNTER_ID ? `/billing/opd/${b.ENCOUNTER_ID}` : `/billing/patient/${b.PATIENT_ID}`)}>
                      <span className="cell-stack">
                        <span className="cell-primary">{b.PATIENT_NAME}</span>
                        <span className="cell-secondary">{b.BILL_NUMBER} · {fmtDate(b.CREATED_AT)}</span>
                      </span>
                      <span className="tabular" style={{ fontWeight: 650 }}>{inr(b.NET_PAYABLE)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Receipt size={16} aria-hidden="true" /> Recent bills</h2></div>
          <DataTable
            columns={columns}
            data={bills}
            loading={loading}
            getRowId={(b) => String(b.ID)}
            pageSize={15}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={<EmptyState icon={Receipt} title="No bills yet" description="Bills appear here as soon as OPD or IPD billing starts." />}
          />
        </section>
      </main>
    </>
  );
}
