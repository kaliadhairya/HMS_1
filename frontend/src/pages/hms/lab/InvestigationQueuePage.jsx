import { useState, useEffect, useMemo } from 'react';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, RefreshCw, Search } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const PRIORITY_RANK = { STAT: 0, Urgent: 1, Routine: 2 };
const PRIORITY_TONE = { STAT: 'danger', Urgent: 'warning', Routine: 'success' };

export default function InvestigationQueuePage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchQueue = async () => {
    try {
      const res = await api.get('/lab/queue');
      setOrders(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load ordered investigations');
    } finally {
      setLoading(false);
    }
  };

  const processTests = async (order) => {
    try {
      await api.patch(`/lab/queue/${order.id}`, { status: 'In Progress' });
      navigate('/lab/results');
      toast.success(`Moved ${order.patient} to results entry`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update lab queue');
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => [o.patient, o.uhid, o.doctor, ...(o.tests || [])].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [orders, query]);

  const columns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (o) => o.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient}</span>
          <span className="cell-secondary mono">{row.original.uhid}</span>
        </span>
      ),
    },
    { id: 'time', header: 'Ordered at', accessorFn: (o) => o.time || '', meta: { width: 110 }, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> },
    {
      id: 'tests', header: 'Tests ordered', accessorFn: (o) => (o.tests || []).join(', '), enableSorting: false,
      cell: ({ row }) => {
        const tests = row.original.tests || [];
        if (tests.length === 0) return <span className="cell-secondary">No tests listed</span>;
        return (
          <span className="chip-row" style={{ gap: 4 }}>
            {tests.slice(0, 4).map((t, idx) => <span key={idx} className="tag">{t}</span>)}
            {tests.length > 4 && <span className="tag tag-more">+{tests.length - 4}</span>}
          </span>
        );
      },
    },
    { id: 'doctor', header: 'Doctor', accessorFn: (o) => o.doctor || '', meta: { width: 170 }, cell: ({ getValue }) => `Dr. ${getValue()}` },
    {
      id: 'priority', header: 'Urgency', accessorFn: (o) => PRIORITY_RANK[o.priority] ?? 2, meta: { width: 110 },
      cell: ({ row }) => <span className={`status status-${PRIORITY_TONE[row.original.priority] || 'neutral'}`}>{row.original.priority}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 140, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => processTests(row.original)}>Process tests</button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Ordered investigations"
          description="Lab tests ordered during doctor consultations. Refreshes every 30 seconds."
          meta={!loading && <span className="muted">{orders.length} pending {orders.length === 1 ? 'order' : 'orders'}</span>}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchQueue}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search investigations</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, test or doctor" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(o) => String(o.id)}
            pageSize={50}
            empty={orders.length > 0 ? (
              <EmptyState icon={Search} title="No orders match" description="Try another patient, test or doctor." />
            ) : (
              <EmptyState icon={FlaskConical} title="No pending orders" description="Investigations ordered during consultations appear here." />
            )}
          />
        </section>
      </main>
    </>
  );
}
