import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { FlaskConical, RefreshCw, Search, TestTubes } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import { useSocket } from '../../../context/SocketContext';

const PRIORITY_RANK = { STAT: 0, Urgent: 1, Routine: 2 };
const PRIORITY_TONE = { STAT: 'danger', Urgent: 'warning', Routine: 'neutral' };
const STATUS_TONE = { Pending: 'warning', Ordered: 'warning', 'In Progress': 'info' };

const waitMinutes = (o) => (o.ordered_at ? Math.max(0, Math.round((Date.now() - new Date(o.ordered_at).getTime()) / 60000)) : null);
const fmtWait = (m) => {
  if (m === null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
};

export default function LabTestQueuePage() {
  const navigate = useNavigate();
  const socket = useSocket();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('');
  const [, setTick] = useState(0);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await api.get('/lab/queue');
      setQueue(res.data.data || []);
    } catch {
      toast.error('Could not load the test queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Keep the "waiting" column current without refetching.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onOrder = () => {
      toast('New investigation order received', { id: 'new-lab-order', duration: 4000 });
      fetchQueue();
    };
    socket.on('new_lab_order', onOrder);
    return () => { socket.off('new_lab_order', onOrder); };
  }, [socket, fetchQueue]);

  const counts = useMemo(() => ({
    all: queue.length,
    STAT: queue.filter((o) => o.priority === 'STAT').length,
    Urgent: queue.filter((o) => o.priority === 'Urgent').length,
    Routine: queue.filter((o) => (o.priority || 'Routine') === 'Routine').length,
  }), [queue]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return queue.filter((o) => {
      if (priority && (o.priority || 'Routine') !== priority) return false;
      if (!q) return true;
      return [o.id, o.patient, o.uhid, o.doctor, o.dept, ...(o.tests || [])].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [queue, query, priority]);

  const columns = useMemo(() => [
    {
      id: 'priority', header: 'Priority', meta: { width: 110 },
      accessorFn: (o) => PRIORITY_RANK[o.priority] ?? 2,
      cell: ({ row }) => {
        const p = row.original.priority || 'Routine';
        return <span className={`status status-${PRIORITY_TONE[p] || 'neutral'}`}>{p}</span>;
      },
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (o) => o.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient}</span>
          <span className="cell-secondary mono">{row.original.uhid}</span>
        </span>
      ),
    },
    {
      id: 'tests', header: 'Tests requested', accessorFn: (o) => (o.tests || []).join(', '),
      cell: ({ row }) => {
        const tests = row.original.tests || [];
        if (tests.length === 0) return <span className="cell-secondary">No tests listed</span>;
        return (
          <span className="chip-row" style={{ gap: 4 }}>
            {tests.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}
            {tests.length > 4 && <span className="tag tag-more">+{tests.length - 4}</span>}
          </span>
        );
      },
    },
    {
      id: 'doctor', header: 'Ordered by', accessorFn: (o) => o.doctor || '', meta: { width: 170 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.doctor}</span>
          <span className="cell-secondary">{row.original.dept}</span>
        </span>
      ),
    },
    {
      id: 'waiting', header: 'Waiting', meta: { width: 140 },
      accessorFn: (o) => waitMinutes(o) ?? -1,
      cell: ({ row }) => {
        const m = waitMinutes(row.original);
        const late = m !== null && m > (row.original.priority === 'STAT' ? 60 : 240);
        return (
          <span className="cell-stack" style={{ whiteSpace: 'nowrap' }}>
            <span className="tabular" style={{ fontWeight: 600, color: late ? 'var(--red)' : undefined }}>{fmtWait(m)}</span>
            <span className="cell-secondary" title={`Ordered at ${row.original.time}`}><span className="mono">{row.original.id}</span> · {row.original.time}</span>
          </span>
        );
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (o) => o.status || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'neutral'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 130, align: 'right' },
      cell: () => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); navigate('/lab/samples'); }}>
          <TestTubes size={14} aria-hidden="true" /> Log sample
        </button>
      ),
    },
  ], [navigate]);

  const statCount = counts.STAT;

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Test queue"
          description="Investigations waiting for sample collection, most urgent first. Updates live as doctors order."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchQueue}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        {statCount > 0 && (
          <div className="alert-strip alert-danger" role="status">
            <strong>{statCount} STAT {statCount === 1 ? 'order' : 'orders'}</strong> waiting. Collect these first.
          </div>
        )}

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter by priority">
              {[['', 'All', counts.all], ['STAT', 'STAT', counts.STAT], ['Urgent', 'Urgent', counts.Urgent], ['Routine', 'Routine', counts.Routine]].map(([key, label, n]) => (
                <button key={label} type="button" role="tab" aria-selected={priority === key} className={priority === key ? 'is-active' : ''} onClick={() => setPriority(key)}>
                  {label} <span className="seg-count">{n}</span>
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search the queue</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, order, test or doctor" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(o) => String(o.id)}
            initialSorting={[{ id: 'priority', desc: false }, { id: 'waiting', desc: true }]}
            pageSize={50}
            empty={queue.length > 0 ? (
              <EmptyState icon={Search} title="No orders match" description="Clear the search or choose another priority." />
            ) : (
              <EmptyState icon={FlaskConical} title="Queue is clear" description="New investigation orders appear here as soon as a doctor places them." />
            )}
          />
        </section>
      </main>
    </>
  );
}
