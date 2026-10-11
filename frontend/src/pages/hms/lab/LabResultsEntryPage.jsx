import { useState, useEffect, useMemo } from 'react';
import { ClipboardList, NotebookPen, RefreshCw, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { toast } from 'react-hot-toast';
import { abnormalFlag, isAbnormal, FlagTag, fmtTime } from './labFlags';

const PRIORITY_RANK = { STAT: 0, Urgent: 1, Routine: 2 };
const PRIORITY_TONE = { STAT: 'danger', Urgent: 'warning', Routine: 'success' };

export default function LabResultsEntryPage() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [resultValue, setResultValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [referenceRange, setReferenceRange] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
    setReferenceRange(selected?.referenceRange || '');
  }, [selected]);

  const previewFlag = abnormalFlag(resultValue, referenceRange);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!selected || submitting) return;
    if (!resultValue.trim()) {
      toast.error('Observed value is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post(`/lab/results/${selected.id}`, {
        result_value: resultValue.trim(),
        reference_range: referenceRange.trim(),
        remarks: remarks.trim(),
      });
      const flag = res.data?.data?.flag;
      if (isAbnormal(flag)) {
        toast.success(`Result saved for ${selected.test}. ${flag === 'High' ? 'Above' : 'Below'} the reference range, flagged for the ordering doctor.`, { duration: 6000 });
      } else {
        toast.success(`Result saved for ${selected.test}`);
      }
      setSelected(null);
      setResultValue('');
      setRemarks('');
      setReferenceRange('');
      setLoading(true);
      loadPending();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save result');
      if (err.response?.status === 409) { setSelected(null); setLoading(true); loadPending(); }
    } finally {
      setSubmitting(false);
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
          <span className="cell-secondary tabular">{fmtTime(row.original.ordered_at)}</span>
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 140, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="btn btn-primary btn-sm" aria-label={`Enter result for ${row.original.test}, ${row.original.patient}`} onClick={(e) => { e.stopPropagation(); setSelected(row.original); }}>
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
            <button type="submit" form="lab-result-form" className="btn btn-primary btn-md" disabled={submitting}>{submitting ? 'Saving…' : 'Submit result'}</button>
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
            <div className="form-row-2">
              <div className="form-group">
                <label className="form-label" htmlFor="lab-result-value">Observed value</label>
                <input
                  id="lab-result-value"
                  type="text"
                  className="form-input"
                  placeholder="e.g. 9.1 g/dL"
                  value={resultValue}
                  onChange={(e) => setResultValue(e.target.value)}
                  maxLength={500}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="lab-result-range">Reference range</label>
                <input
                  id="lab-result-range"
                  type="text"
                  className="form-input"
                  placeholder="e.g. 12-16 g/dL"
                  value={referenceRange}
                  onChange={(e) => setReferenceRange(e.target.value)}
                  maxLength={500}
                  aria-describedby="lab-result-range-hint"
                />
              </div>
            </div>
            <div className="form-hint" id="lab-result-range-hint" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -6 }}>
              {previewFlag ? (
                <>
                  <FlagTag flag={previewFlag} />
                  <span>{isAbnormal(previewFlag) ? `${previewFlag === 'High' ? 'Above' : 'Below'} the reference range. It will be flagged for the doctor.` : 'Within the reference range.'}</span>
                </>
              ) : (
                <span>Use a range such as 12-16, &lt;200 or &gt;40. Results outside it are flagged high or low.</span>
              )}
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
