import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { CircleCheck, FileDown, FlaskConical, ListOrdered, Search, X } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';
import { FlagTag, isAbnormal } from '../lab/labFlags';

const PRIORITY_RANK = { STAT: 0, Urgent: 1, Routine: 2 };
const PRIORITY_TONE = { STAT: 'danger', Urgent: 'danger', Routine: 'info' };
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

// Investigations the doctor ordered (or, from a patient's menu, every order for that patient), one row per test.
export default function DoctorLabsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const patientId = searchParams.get('patientId');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [query, setQuery] = useState('');
  const [reviewOrderId, setReviewOrderId] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/hms/investigation-orders', { params: patientId ? { patient_id: patientId } : {} })
      .then((res) => setOrders(res.data.data || []))
      .catch((err) => toast.error(err.response?.data?.error || 'Could not load lab orders'))
      .finally(() => setLoading(false));
  }, [patientId]);

  const labs = useMemo(() => orders.flatMap((o) => (o.tests || [])
    .filter((t) => t.status !== 'Cancelled')
    .map((t) => ({
      id: `LR-${t.itemId}`,
      orderId: o.orderId,
      patientId: o.patientId,
      date: o.orderedAt,
      patient: o.patient,
      uhid: o.uhid,
      test: t.test,
      status: t.status,
      priority: o.priority || 'Routine',
      result: t.result,
      referenceRange: t.referenceRange,
      flag: t.flag,
    }))), [orders]);

  const pending = labs.filter((l) => l.status !== 'Completed');
  const completed = labs.filter((l) => l.status === 'Completed');
  const abnormalCount = completed.filter((l) => isAbnormal(l.flag)).length;
  const displayed = tab === 'pending' ? pending : completed;
  const patientLabel = patientId ? (orders[0]?.patient || `patient ${patientId}`) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displayed;
    return displayed.filter((l) => [l.id, l.patient, l.uhid, l.test].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [displayed, query]);

  const reviewOrder = orders.find((o) => o.orderId === reviewOrderId) || null;

  const downloadPdf = async (order) => {
    if (downloading) return;
    setDownloading(true);
    try {
      await openAuthenticatedBlob(`/pdf/lab-report/${order.orderId}?download=true`, { download: true, filename: `lab-report-${order.orderId}.pdf` });
    } catch {
      toast.error('Could not generate the PDF report');
    } finally {
      setDownloading(false);
    }
  };

  const columns = useMemo(() => [
    {
      id: 'date', header: 'Date', accessorFn: (l) => (l.date ? new Date(l.date).getTime() : 0), meta: { width: 120 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDate(row.original.date)}</span>,
    },
    { id: 'id', header: 'Request', accessorFn: (l) => l.id || '', meta: { width: 100 }, cell: ({ getValue }) => <span className="mono">{getValue()}</span> },
    {
      id: 'patient', header: 'Patient', accessorFn: (l) => l.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient}</span>
          <span className="cell-secondary mono">{row.original.uhid}</span>
        </span>
      ),
    },
    { id: 'test', header: 'Investigation', accessorFn: (l) => l.test || '' },
    {
      id: 'result', header: 'Result', accessorFn: (l) => l.result || '', enableSorting: false,
      cell: ({ row }) => {
        const l = row.original;
        if (l.status !== 'Completed') return <span className="cell-secondary">{l.status === 'Pending' ? 'Sample not collected' : 'Sample in lab'}</span>;
        return (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
            <strong className="tabular" style={{ color: isAbnormal(l.flag) ? 'var(--red)' : undefined }}>{l.result}</strong>
            {l.referenceRange && <span className="cell-secondary">({l.referenceRange})</span>}
            <FlagTag flag={l.flag} />
          </span>
        );
      },
    },
    {
      id: 'priority', header: 'Priority', accessorFn: (l) => PRIORITY_RANK[l.priority] ?? 2, meta: { width: 100 },
      cell: ({ row }) => <span className={`status status-${PRIORITY_TONE[row.original.priority] || 'info'}`}>{row.original.priority}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (l) => l.status || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Completed' ? 'status-success' : 'status-warning'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Report</span>, enableSorting: false, meta: { width: 240, align: 'right' },
      // Released reports, result review and critical-result follow-up live in
      // the laboratory workspace; this page only shows what was ordered.
      cell: ({ row }) => (
        <span className="inline-actions" style={{ justifyContent: 'flex-end' }}>
          {row.original.status === 'Completed' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReviewOrderId(row.original.orderId)} aria-label={`Earlier report view for ${row.original.test}, ${row.original.patient}`}>
              Earlier view
            </button>
          )}
          {row.original.patientId && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/lab/governed?patient_id=${row.original.patientId}`)} aria-label={`Open ${row.original.patient} in the laboratory workspace`}>
              Open in laboratory
            </button>
          )}
        </span>
      ),
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Lab and diagnostics"
          description="Track the investigations you ordered and review results. Order new tests from a consultation."
          meta={patientLabel && (
            <span className="chip-row">
              <span className="status status-info">Patient: {patientLabel}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearchParams({})}>
                <X size={14} aria-hidden="true" /> Show all my orders
              </button>
            </span>
          )}
          actions={(
            <span className="inline-actions">
              {patientId && (
                <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate(`/lab/governed?patient_id=${patientId}`)}>
                  <FlaskConical size={16} aria-hidden="true" /> Order coded tests and review results
                </button>
              )}
              <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/appointments')}>
                <ListOrdered size={16} aria-hidden="true" /> Open consultation queue
              </button>
            </span>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Tests ordered</div><div className="kpi-value">{loading ? '—' : labs.length}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Awaiting results</div>
            <div className="kpi-value" style={{ color: pending.length > 0 ? 'var(--amber)' : undefined }}>{loading ? '—' : pending.length}</div>
          </div>
          <div className="panel kpi"><div className="kpi-label">Results ready</div><div className="kpi-value">{loading ? '—' : completed.length}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Outside reference range</div>
            <div className="kpi-value" style={{ color: abnormalCount > 0 ? 'var(--red)' : undefined }}>{loading ? '—' : abnormalCount}</div>
          </div>
        </div>

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter by status">
              {[['pending', 'Awaiting results', pending.length], ['completed', 'Results ready', completed.length]].map(([key, label, n]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
                  {label} <span className="seg-count">{n}</span>
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search investigations</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, request or test" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(l) => String(l.id)}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={displayed.length > 0 ? (
              <EmptyState icon={Search} title="No investigations match" description="Try another patient name, request number or test." />
            ) : tab === 'pending' ? (
              <EmptyState icon={CircleCheck} title="Nothing awaiting results" description="Investigations you order appear here until the lab reports them." />
            ) : (
              <EmptyState icon={FlaskConical} title="No results yet" description="Results appear here once the lab enters them." />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(reviewOrder)}
        onOpenChange={(open) => { if (!open) setReviewOrderId(null); }}
        title={reviewOrder ? `Lab report ORD-${reviewOrder.orderId}` : 'Lab report'}
        description={reviewOrder ? `${reviewOrder.patient} (${reviewOrder.uhid}) · ${reviewOrder.priority} · ordered ${fmtDateTime(reviewOrder.orderedAt)}` : ''}
        size="lg"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setReviewOrderId(null)}>Close</button>
            {reviewOrder && (
              <button type="button" className="btn btn-primary btn-md" onClick={() => downloadPdf(reviewOrder)} disabled={downloading}>
                <FileDown size={16} aria-hidden="true" /> {downloading ? 'Preparing…' : 'Download PDF'}
              </button>
            )}
          </>
        )}
      >
        {reviewOrder && (
          <p className="cell-secondary">Earlier view of this order. Released reports, result review and critical results are in the{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/lab/governed?patient_id=${reviewOrder.patientId}`)}>laboratory workspace</button>.
            Opening this view does not acknowledge anything.</p>
        )}
        {reviewOrder && (
          <table className="mini-table">
            <thead><tr><th>Investigation</th><th>Result</th><th>Range (historical, not validated)</th><th>Flag</th></tr></thead>
            <tbody>
              {reviewOrder.tests.filter((t) => t.status !== 'Cancelled').map((t) => (
                <tr key={t.itemId}>
                  <td>
                    <span className="cell-stack">
                      <span>{t.test}</span>
                      {t.remarks && <span className="cell-secondary">{t.remarks}</span>}
                    </span>
                  </td>
                  <td className="tabular" style={{ fontWeight: 600, color: isAbnormal(t.flag) ? 'var(--red)' : undefined }}>{t.status === 'Completed' ? t.result : 'Awaiting result'}</td>
                  <td>{t.referenceRange || '—'}</td>
                  <td><FlagTag flag={t.flag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}
