import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { FileDown, Hourglass, PackageCheck } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

export default function PharmacyReportsPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/pharmacist_lms/reports')
      .then(res => setReport(res.data.data))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load pharmacy reports');
      })
      .finally(() => setLoading(false));
  }, []);

  const show = (v) => (loading || !report ? '—' : v);
  const alerts = Number(report?.stockAlerts || 0);

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Medicine', accessorFn: (r) => r.name || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span>,
    },
    {
      id: 'stock', header: 'Current stock', accessorFn: (r) => Number(r.stock || 0), meta: { width: 160, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{getValue()} units</span>,
    },
    {
      id: 'lastMoved', header: 'Last dispensed', accessorFn: (r) => r.lastMoved || '', meta: { width: 200 },
      cell: ({ getValue }) => <span className="status status-warning">{getValue() || 'Never'}</span>,
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Pharmacy reports"
          description="Daily sales, stock valuation and medicines that are not moving."
          actions={(
            <button type="button" className="btn btn-secondary btn-md" disabled title="PDF export is not available yet">
              <FileDown size={16} aria-hidden="true" /> Export PDF
            </button>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Daily sales (OTC and IPD)</div><div className="kpi-value">{show(report?.dailySales)}</div></div>
          <div className="panel kpi"><div className="kpi-label">Items dispensed</div><div className="kpi-value">{show(report?.totalDispensed)}</div></div>
          <div className="panel kpi"><div className="kpi-label">Estimated inventory value</div><div className="kpi-value">{show(report?.inventoryValue)}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Active stock alerts</div>
            <div className="kpi-value" style={{ color: alerts > 0 ? 'var(--red)' : undefined }}>{show(report?.stockAlerts)}</div>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><Hourglass size={16} aria-hidden="true" /> Slow-moving inventory</h2>
          </div>
          <DataTable
            columns={columns}
            data={report?.slowMoving || []}
            loading={loading}
            getRowId={(r, i) => String(r.id ?? i)}
            pageSize={15}
            initialSorting={[{ id: 'stock', desc: true }]}
            empty={(
              <EmptyState
                icon={PackageCheck}
                title={report ? 'No slow-moving stock' : 'Report unavailable'}
                description={report ? 'Every medicine in stock has been dispensed recently.' : 'The report could not be loaded. Refresh the page to try again.'}
              />
            )}
          />
        </section>
      </main>
    </>
  );
}
