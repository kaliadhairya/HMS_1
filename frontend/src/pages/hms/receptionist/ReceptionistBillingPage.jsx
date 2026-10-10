import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CircleCheck, Copy, Receipt, ArrowRight } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const METHOD_TONE = { Cash: 'success', UPI: 'info', Card: 'info' };

export default function ReceptionistBillingPage() {
  const navigate = useNavigate();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('unpaid');

  useEffect(() => {
    api.get('/receptionist/billing-summary')
      .then(res => setBilling(res.data.data))
      .catch((err) => { console.error(err); toast.error('Could not load billing summary'); })
      .finally(() => setLoading(false));
  }, []);

  const unpaid = billing?.unpaid_today || [];
  const payments = billing?.recent_payments || [];

  const unpaidColumns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (u) => u.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient || '—'}</span>
          <span className="cell-secondary mono">{row.original.uhid || 'No UHID'}</span>
        </span>
      ),
    },
    { id: 'doctor', header: 'Doctor', accessorFn: (u) => u.doctor || '', cell: ({ getValue }) => getValue() || '—' },
    { id: 'department', header: 'Department', accessorFn: (u) => u.department || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'amount', header: 'Amount', accessorFn: (u) => Number(u.amount || 0), meta: { width: 130, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{inr(getValue())}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 150, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/billing/opd/${row.original.encounter_id}`); }}>
          Open billing <ArrowRight size={14} aria-hidden="true" />
        </button>
      ),
    },
  ], [navigate]);

  const paymentColumns = useMemo(() => [
    {
      id: 'receipt', header: 'Receipt no.', accessorFn: (p) => String(p.receipt_no || ''), meta: { width: 170 },
      cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span>,
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (p) => p.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient || '—'}</span>
          <span className="cell-secondary mono">{row.original.uhid || 'No UHID'}</span>
        </span>
      ),
    },
    {
      id: 'amount', header: 'Amount', accessorFn: (p) => Number(p.amount || 0), meta: { width: 130, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{inr(getValue())}</span>,
    },
    {
      id: 'method', header: 'Method', accessorFn: (p) => p.method || '', meta: { width: 110 },
      cell: ({ getValue }) => <span className={`status status-${METHOD_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'when', header: 'Date and time', enableSorting: false, accessorFn: (p) => `${p.date || ''} ${p.time || ''}`, meta: { width: 180 },
      cell: ({ getValue }) => <span className="tabular cell-secondary">{getValue().trim() || '—'}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 100, align: 'right' },
      cell: ({ row }) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`Copy receipt number ${row.original.receipt_no || ''}`}
          onClick={() => {
            navigator.clipboard.writeText(String(row.original.receipt_no || ''));
            toast.success('Receipt number copied');
          }}
        >
          <Copy size={14} aria-hidden="true" /> Copy
        </button>
      ),
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Billing and payments"
          description="Generate OPD bills, collect payments and issue receipts."
        />

        {billing && (
          <div className="kpi-strip">
            <div className="panel kpi"><div className="kpi-label">Collected today</div><div className="kpi-value">{inr(billing.todays_collection)}</div></div>
            <div className="panel kpi">
              <div className="kpi-label">Pending amount</div>
              <div className="kpi-value" style={{ color: Number(billing.pending_total) > 0 ? 'var(--amber)' : undefined }}>{inr(billing.pending_total)}</div>
            </div>
            <div className="panel kpi"><div className="kpi-label">Unpaid encounters today</div><div className="kpi-value">{unpaid.length}</div></div>
            <div className="panel kpi"><div className="kpi-label">Receipts issued</div><div className="kpi-value">{payments.length}</div></div>
          </div>
        )}

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Billing view">
              <button type="button" role="tab" aria-selected={tab === 'unpaid'} className={tab === 'unpaid' ? 'is-active' : ''} onClick={() => setTab('unpaid')}>
                Unpaid encounters <span className="seg-count">{unpaid.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'is-active' : ''} onClick={() => setTab('recent')}>
                Recent payments <span className="seg-count">{payments.length}</span>
              </button>
            </div>
          </div>

          {tab === 'unpaid' && (
            <DataTable
              key="unpaid"
              columns={unpaidColumns}
              data={unpaid}
              loading={loading}
              getRowId={(u) => String(u.encounter_id)}
              empty={<EmptyState icon={CircleCheck} title="No unpaid OPD bills" description="Every finalized consultation from today has been billed and paid." />}
            />
          )}

          {tab === 'recent' && (
            <DataTable
              key="recent"
              columns={paymentColumns}
              data={payments}
              loading={loading}
              empty={<EmptyState icon={Receipt} title="No recent payments" description="Payments from the last three days appear here." />}
            />
          )}
        </section>
      </main>
    </>
  );
}
