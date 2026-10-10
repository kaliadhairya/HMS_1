import { useState, useEffect, useMemo } from 'react';
import { ClipboardList, NotebookPen, RefreshCw, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { toast } from 'react-hot-toast';

const PRIORITY_RANK = { STAT: 0, Urgent: 1, Routine: 2 };
const PRIORITY_TONE = { STAT: 'danger', Urgent: 'warning', Routine: 'success' };

export default function LabResultsEntryPage() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [resultValue, setResultValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [query, setQuery] = useState('');

  const loadPending = async () => {
    try {
      const res = await api.get('/lab/results');
      setPending(res.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load pending results');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  useEffect(() => {
    setResultValue(selected?.currentResult || '');
    setRemarks(selected?.remarks || '');
  }, [selected]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!selected) return;
    if (!resultValue.trim()) {
      toast.error('Observed value is required');
      return;
    }

    try {
      await api.post(`/lab/results/${selected.id}`, {
        result_value: resultValue.trim(),
        remarks: remarks.trim(),
      });
      toast.success('Result submitted successfully');
      setSelected(null);
      setResultValue('');
      setRemarks('');
      setLoading(true);
      loadPending();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save result');
    }
  };

  const statCount = pending.filter((p) => p.priority === 'STAT').length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter((p) => [p.patient, p.uhid, p.test, p.sampleBarcode, p.orderedBy].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [pending, query]);

  const columns = useMemo(() => [
    {
      id: 'priority', header: 'Priority', accessorFn: (p) => PRIORITY_RANK[p.priority] ?? 2, meta: { width: 110 },
      cell: ({ row }) => {
        const p = row.original.priority || 'Routine';
        return <span className={`status status-${PRIORITY_TONE[p] || 'neutral'}`}>{p}</span>;
      },
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (p) => p.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient}</span>
          <span className="cell-secondary mono">{row.original.uhid}</span>
        </span>
      ),
    },
    {
      id: 'test', header: 'Test', accessorFn: (p) => p.test || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.test}</span>
          {row.original.currentResult && <span className="cell-secondary">Draft value: {row.original.currentResult}</span>}
        </span>
      ),
    },
    { id: 'barcode', header: 'Barcode', accessorFn: (p) => p.sampleBarcode || '', meta: { width: 120 }, cell: ({ getValue }) => <span className="mono">{getValue()}</span> },
    {
      id: 'orderedBy', header: 'Ordered by', accessorFn: (p) => p.orderedBy || '', meta: { width: 170 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.orderedBy}</span>
          <span className="cell-secondary tabular">{row.original.time}</span>
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 140, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setSelected(row.original); }}>
          <NotebookPen size={14} aria-hidden="true" /> Enter result
        </button>
      ),
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Results entry"
          description="Enter observed values and remarks for collected samples. Submitted results go to the ordering doctor."
          meta={!loading && <span className="muted">{pending.length} awaiting results</span>}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => { setLoading(true); loadPending(); }}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        {statCount > 0 && (
          <div className="alert-strip alert-danger" role="status">
            <strong>{statCount} STAT {statCount === 1 ? 'test' : 'tests'}</strong> waiting for results. Enter these first.
          </div>
        )}

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search pending tests</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, test or barcode" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(p) => String(p.id)}
            onRowClick={setSelected}
            rowLabel={(p) => `Enter result for ${p.test}, ${p.patient}`}
            initialSorting={[{ id: 'priority', desc: false }]}
            pageSize={50}
            empty={pending.length > 0 ? (
              <EmptyState icon={Search} title="No tests match" description="Try another patient, test or barcode." />
            ) : (
              <EmptyState icon={ClipboardList} title="No results pending" description="Tests appear here once their samples have been logged." />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.test || 'Enter result'}
        description={selected ? `${selected.patient} (${selected.uhid}) · Ordered by ${selected.orderedBy}` : ''}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setSelected(null)}>Cancel</button>
            <button type="submit" form="lab-result-form" className="btn btn-primary btn-md">Submit result</button>
          </>
        )}
      >
        {selected && (
          <form id="lab-result-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
            <div className="facts">
              <div><div className="fact-label">Sample barcode</div><div className="fact-value mono">{selected.sampleBarcode}</div></div>
              <div>
                <div className="fact-label">Priority</div>
                <div className="fact-value">
                  <span className={`status status-${PRIORITY_TONE[selected.priority || 'Routine'] || 'neutral'}`}>{selected.priority || 'Routine'}</span>
                </div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="lab-result-value">Observed value</label>
              <input
                id="lab-result-value"
                type="text"
                className="form-input"
                placeholder="Enter measured value"
                value={resultValue}
                onChange={(e) => setResultValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="lab-result-remarks">Technician remarks</label>
              <textarea
                id="lab-result-remarks"
                className="form-textarea"
                rows="3"
                placeholder="Findings, specimen notes or anomalies"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
