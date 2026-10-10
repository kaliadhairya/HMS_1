import { useState, useEffect, useMemo } from 'react';
import { FileText, Printer, Search, Send } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

export default function LabReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.get('/lab/reports')
      .then(res => setReports(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => [r.id, r.patient, r.test].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [reports, query]);

  const columns = useMemo(() => [
    {
      id: 'id', header: 'Report', accessorFn: (r) => r.id || '', meta: { width: 130 },
      cell: ({ getValue }) => <span className="mono">{getValue()}</span>,
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (r) => r.patient || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span>,
    },
    {
      id: 'test', header: 'Test', accessorFn: (r) => r.test || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>
            {row.original.test}
            {row.original.flag === 'Critical' && <span className="status status-danger" style={{ marginLeft: 8 }}>Critical</span>}
          </span>
          {row.original.result && <span className="cell-secondary">Result: {row.original.result}</span>}
        </span>
      ),
    },
    { id: 'time', header: 'Generated', accessorFn: (r) => r.time || '', meta: { width: 130 }, cell: ({ getValue }) => <span className="cell-secondary">{getValue()}</span> },
    { id: 'verifiedBy', header: 'Verified by', accessorFn: (r) => r.verifiedBy || '', meta: { width: 150 } },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.status || '', meta: { width: 150 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className={`status ${row.original.status === 'Final' ? 'status-success' : 'status-warning'}`}>{row.original.status}</span>
          {row.original.printed && <span className="cell-secondary">Printed</span>}
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 200, align: 'right' },
      cell: ({ row }) => {
        const notFinal = row.original.status !== 'Final';
        return (
          <span className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={notFinal}><FileText size={14} aria-hidden="true" /> PDF</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={notFinal}><Printer size={14} aria-hidden="true" /> Print</button>
            <button type="button" className="icon-btn" disabled={notFinal} aria-label={`Send ${row.original.id} on WhatsApp`} title="Send on WhatsApp"><Send size={16} aria-hidden="true" /></button>
          </span>
        );
      },
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Lab reports"
          description="Final results ready to download, print or share with doctors and patients."
          meta={!loading && <span className="muted">{reports.length} reports</span>}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search reports</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, report or test" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(r) => String(r.id)}
            empty={reports.length > 0 ? (
              <EmptyState icon={Search} title="No reports match" description="Try another patient name, report number or test." />
            ) : (
              <EmptyState icon={FileText} title="No final reports yet" description="Reports appear here once results are entered and verified." />
            )}
          />
        </section>
      </main>
    </>
  );
}
