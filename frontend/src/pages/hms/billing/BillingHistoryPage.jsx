import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Receipt, ArrowRight } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS_TONE = { Paid: 'success', 'Partially Paid': 'warning', Pending: 'warning', Cancelled: 'neutral' };

export default function BillingHistoryPage() {
  const { patientId } = useParams();
  const [bills, setBills] = useState([]);
  const [advance, setAdvance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [billsRes, advRes] = await Promise.all([
          api.get(`/billing/patient/${patientId}`),
          api.get(`/billing/advance/${patientId}`)
        ]);
        setBills(billsRes.data.data);
        setAdvance(advRes.data.data);
      } catch (err) {
        toast.error('Could not load billing history');
      } finally {
        setLoading(false);
      }
    };
    if (patientId) fetchData();
  }, [patientId]);

  const columns = useMemo(() => [
    {
      id: 'date', header: 'Date', accessorFn: (b) => (b.CREATED_AT ? new Date(b.CREATED_AT).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="tabular">{fmtDate(row.original.CREATED_AT)}</span>,
    },
    {
      id: 'bill', header: 'Bill no.', accessorFn: (b) => b.BILL_NUMBER || '', meta: { width: 180 },
      cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span>,
    },
    { id: 'type', header: 'Type', accessorFn: (b) => b.BILL_TYPE || '', meta: { width: 90 } },
    {
      id: 'total', header: 'Total', accessorFn: (b) => Number(b.NET_PAYABLE || 0), meta: { width: 130, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span>,
    },
    {
      id: 'paid', header: 'Paid', accessorFn: (b) => Number(b.PAID_AMOUNT || 0), meta: { width: 130, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (b) => b.STATUS || '', meta: { width: 140 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'info'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 130, align: 'right' },
      cell: ({ row }) => {
        const b = row.original;
        if (!(b.BILL_TYPE === 'OPD' && b.ENCOUNTER_ID)) return null;
        return (
          <Link to={`/billing/opd/${b.ENCOUNTER_ID}`} className="btn btn-secondary btn-sm">
            View or pay <ArrowRight size={14} aria-hidden="true" />
          </Link>
        );
      },
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Patient billing history"
          description="Every bill raised for this patient, with payments and advance deposits."
          meta={!loading && <span className="muted">{bills.length} {bills.length === 1 ? 'bill' : 'bills'}</span>}
        />

        {advance && (
          <div className="kpi-strip">
            <div className="panel kpi">
              <div className="kpi-label">Advance deposited</div>
              <div className="kpi-value">{inr(advance.totalAdvance)}</div>
            </div>
            <div className="panel kpi">
              <div className="kpi-label">Available balance</div>
              <div className="kpi-value" style={{ color: 'var(--primary)' }}>{inr(advance.availableAdvance)}</div>
            </div>
          </div>
        )}

        <section className="panel">
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Receipt size={16} aria-hidden="true" /> Bills</h2></div>
          <DataTable
            columns={columns}
            data={bills}
            loading={loading}
            getRowId={(b) => String(b.ID)}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={<EmptyState icon={Receipt} title="No bills yet" description="Bills for this patient appear here once OPD or IPD billing is generated." />}
          />
        </section>
      </main>
    </>
  );
}
