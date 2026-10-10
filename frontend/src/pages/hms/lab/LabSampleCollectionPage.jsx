import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search, TestTubes } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import { toast } from 'react-hot-toast';

const STATUS_TONE = { 'Pending Collection': 'warning', 'Received in Lab': 'info', Collected: 'success', 'In Progress': 'info', Completed: 'success' };

export default function LabSampleCollectionPage() {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    api.get('/lab/samples')
      .then(res => setSamples(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const refreshSamples = async () => {
    try {
      const res = await api.get('/lab/samples');
      setSamples(res.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reload samples');
    }
  };

  const handleLogSample = async (sample) => {
    if (!sample?.itemId) return;
    try {
      await api.post('/lab/samples', { itemId: sample.itemId });
      toast.success(`Sample logged for ${sample.patient}`);
      refreshSamples();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to log sample');
    }
  };

  const pendingCount = samples.filter((s) => s.status === 'Pending Collection').length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return samples.filter((s) => {
      if (statusFilter === 'pending' && s.status !== 'Pending Collection') return false;
      if (statusFilter === 'logged' && s.status === 'Pending Collection') return false;
      if (!q) return true;
      return [s.id, s.barcode, s.patient, s.tests].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [samples, query, statusFilter]);

  const columns = useMemo(() => [
    {
      id: 'id', header: 'Sample', accessorFn: (s) => s.itemId || 0, meta: { width: 150 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="mono cell-primary">{row.original.id}</span>
          <span className="cell-secondary mono">{row.original.barcode}</span>
        </span>
      ),
    },
    { id: 'patient', header: 'Patient', accessorFn: (s) => s.patient || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'tests', header: 'Test', accessorFn: (s) => s.tests || '' },
    {
      id: 'type', header: 'Sample details', accessorFn: (s) => s.type || '', meta: { width: 170 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.type}</span>
          <span className="cell-secondary">By {row.original.collector}</span>
        </span>
      ),
    },
    { id: 'collectedAt', header: 'Collected', accessorFn: (s) => s.collectedAt || '', meta: { width: 110 } },
    { id: 'storage', header: 'Storage', accessorFn: (s) => s.storage || '', meta: { width: 150 }, cell: ({ getValue }) => <span className="cell-secondary">{getValue()}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (s) => s.status || '', meta: { width: 160 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'success'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 130, align: 'right' },
      cell: ({ row }) => (row.original.status === 'Pending Collection' ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleLogSample(row.original)}>
          <TestTubes size={14} aria-hidden="true" /> Log sample
        </button>
      ) : <span className="cell-secondary">Logged</span>),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Sample collection"
          description="Log sample collection, check barcodes and track storage."
          meta={!loading && <span className="muted">{pendingCount} waiting for collection</span>}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={refreshSamples}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter by collection status">
              {[['', 'All', samples.length], ['pending', 'Pending', pendingCount], ['logged', 'Logged', samples.length - pendingCount]].map(([key, label, n]) => (
                <button key={label} type="button" role="tab" aria-selected={statusFilter === key} className={statusFilter === key ? 'is-active' : ''} onClick={() => setStatusFilter(key)}>
                  {label} <span className="seg-count">{n}</span>
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search samples</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, sample, barcode or test" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(s) => String(s.id)}
            pageSize={50}
            empty={samples.length > 0 ? (
              <EmptyState icon={Search} title="No samples match" description="Clear the search or choose another status." />
            ) : (
              <EmptyState icon={TestTubes} title="No samples yet" description="Samples appear here once investigations are ordered." />
            )}
          />
        </section>
      </main>
    </>
  );
}
