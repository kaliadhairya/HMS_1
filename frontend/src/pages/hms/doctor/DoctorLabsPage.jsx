import { useState, useEffect, useMemo } from 'react';
import { CircleCheck, FlaskConical, Plus, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const PRIORITY_RANK = { STAT: 0, Urgent: 1, Routine: 2 };
const PRIORITY_TONE = { STAT: 'danger', Urgent: 'danger', Routine: 'info' };
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function DoctorLabsPage() {
  const [labs, setLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.get('/doctor/labs')
      .then(res => setLabs(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const pending = labs.filter(l => l.status !== 'Completed');
  const completed = labs.filter(l => l.status === 'Completed');
  const displayed = tab === 'pending' ? pending : completed;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displayed;
    return displayed.filter((l) => [l.id, l.patient, l.test].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [displayed, query]);

  const columns = useMemo(() => [
    {
      id: 'date', header: 'Date', accessorFn: (l) => (l.date ? new Date(l.date).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDate(row.original.date)}</span>,
    },
    { id: 'id', header: 'Request', accessorFn: (l) => l.id || '', meta: { width: 120 }, cell: ({ getValue }) => <span className="mono">{getValue()}</span> },
    { id: 'patient', header: 'Patient', accessorFn: (l) => l.patient || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'test', header: 'Investigation', accessorFn: (l) => l.test || '' },
    {
      id: 'priority', header: 'Priority', accessorFn: (l) => PRIORITY_RANK[l.priority] ?? 2, meta: { width: 110 },
      cell: ({ row }) => <span className={`status status-${PRIORITY_TONE[row.original.priority] || 'info'}`}>{row.original.priority}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (l) => l.status || '', meta: { width: 150 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Completed' ? 'status-success' : 'status-warning'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Report</span>, enableSorting: false, meta: { width: 140, align: 'right' },
      cell: ({ row }) => (row.original.status === 'Completed' ? (
        <button type="button" className="btn btn-secondary btn-sm">Review report</button>
      ) : <span className="cell-secondary">Awaiting result</span>),
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Lab and diagnostics"
          description="Raise investigation requests and review completed test reports."
          actions={(
            <button type="button" className="btn btn-primary btn-md">
              <Plus size={16} aria-hidden="true" /> Request investigation
            </button>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Total orders</div><div className="kpi-value">{labs.length}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Pending review</div>
            <div className="kpi-value" style={{ color: pending.length > 0 ? 'var(--amber)' : undefined }}>{pending.length}</div>
          </div>
          <div className="panel kpi"><div className="kpi-label">Completed</div><div className="kpi-value">{completed.length}</div></div>
        </div>

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter by status">
              {[['pending', 'Pending', pending.length], ['completed', 'Completed', completed.length]].map(([key, label, n]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
                  {label} <span className="seg-count">{n}</span>
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search investigations</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, request or test" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(l) => String(l.id)}
            empty={displayed.length > 0 ? (
              <EmptyState icon={Search} title="No investigations match" description="Try another patient name, request number or test." />
            ) : tab === 'pending' ? (
              <EmptyState icon={CircleCheck} title="No pending reports" description="Investigations you order appear here until results are ready." />
            ) : (
              <EmptyState icon={FlaskConical} title="No completed investigations yet" description="Completed reports appear here once the lab enters results." />
            )}
          />
        </section>
      </main>
    </>
  );
}
