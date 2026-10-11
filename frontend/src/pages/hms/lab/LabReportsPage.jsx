import { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { FileDown, FileText, Printer, RefreshCw, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';
import { FlagTag, fmtDateTime } from './labFlags';

// One report per investigation order: every test on the order with its result, range and flag.
export default function LabReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/lab/reports')
      .then((res) => setReports(res.data.data || []))
      .catch((err) => toast.error(err.response?.data?.message || 'Could not load lab reports'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openPdf = async (report, download) => {
    if (busy) return;
    setBusy(`${report.orderId}-${download ? 'pdf' : 'print'}`);
    try {
      if (download) {
        await openAuthenticatedBlob(`/pdf/lab-report/${report.orderId}?download=true`, { download: true, filename: `lab-report-${report.orderId}.pdf` });
      } else {
        await openAuthenticatedBlob(`/pdf/lab-report/${report.orderId}`);
      }
    } catch {
      toast.error('Could not generate the PDF report');
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => [r.id, r.patient, r.uhid, r.doctor, ...(r.tests || []).map((t) => t.test)]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [reports, query]);

  const columns = useMemo(() => [
    {
      id: 'id', header: 'Report', accessorFn: (r) => r.orderId || 0, meta: { width: 120 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="mono">{row.original.id}</span>
          {row.original.priority && row.original.priority !== 'Routine' && (
            <span><span className={`status status-${row.original.priority === 'STAT' ? 'danger' : 'warning'}`}>{row.original.priority}</span></span>
          )}
        </span>
      ),
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (r) => r.patient || '', meta: { width: 200 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient}</span>
          <span className="cell-secondary mono">{row.original.uhid}</span>
        </span>
      ),
    },
    {
      id: 'results', header: 'Tests and results', enableSorting: false,
      cell: ({ row }) => (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {(row.original.tests || []).map((t) => (
            <li key={t.itemId} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
              <span>{t.test}</span>
              {t.status === 'Completed' ? (
                <>
                  <strong className="tabular" style={{ color: t.flag === 'High' || t.flag === 'Low' ? 'var(--red)' : undefined }}>{t.result}</strong>
                  {t.referenceRange && <span className="cell-secondary">({t.referenceRange})</span>}
                  <FlagTag flag={t.flag} />
                </>
              ) : <span className="cell-secondary">Awaiting result</span>}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'doctor', header: 'Ordered by', accessorFn: (r) => r.doctor || '', meta: { width: 160 },
      cell: ({ getValue }) => <span className="cell-secondary">{getValue()}</span>,
    },
    {
      id: 'time', header: 'Reported', accessorFn: (r) => (r.completedAt ? new Date(r.completedAt).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="cell-secondary tabular">{fmtDateTime(row.original.completedAt)}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.status || '', meta: { width: 130 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className={`status ${row.original.status === 'Final' ? 'status-success' : 'status-warning'}`}>{row.original.status}</span>
          {row.original.abnormalCount > 0 && <span className="cell-secondary" style={{ color: 'var(--red)' }}>{row.original.abnormalCount} abnormal</span>}
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 180, align: 'right' },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => openPdf(r, true)} aria-label={`Download PDF of ${r.id} for ${r.patient}`}>
              <FileDown size={14} aria-hidden="true" /> {busy === `${r.orderId}-pdf` ? 'Preparing…' : 'PDF'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => openPdf(r, false)} aria-label={`Open ${r.id} for ${r.patient} to print`}>
              <Printer size={14} aria-hidden="true" /> Print
            </button>
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy]);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Lab reports"
          description="Reported investigations, one report per order, ready to download or print for doctors and patients."
          meta={!loading && <span className="muted">{reports.length} reports</span>}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={load}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search reports</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, report or test" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(r) => String(r.id)}
            initialSorting={[{ id: 'id', desc: true }]}
            empty={reports.length > 0 ? (
              <EmptyState icon={Search} title="No reports match" description="Try another patient name, report number or test." />
            ) : (
              <EmptyState icon={FileText} title="No reports yet" description="Reports appear here once results are entered for an order." />
            )}
          />
        </section>
      </main>
    </>
  );
}
