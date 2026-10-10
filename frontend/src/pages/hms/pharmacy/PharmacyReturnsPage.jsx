import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Plus, Undo2 } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const TABS = [['All', 'All returns'], ['Patient', 'Patient'], ['Vendor', 'Vendor']];
const NOT_YET = 'Recording returns is not available yet';
const typeOf = (r) => String(r.type || '');

export default function PharmacyReturnsPage() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');

  useEffect(() => {
    api.get('/pharmacist_lms/returns')
      .then(res => setReturns(res.data.data || []))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load returns');
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredReturns = activeTab === 'All'
    ? returns
    : returns.filter(r => typeOf(r).includes(activeTab));

  const counts = {
    All: returns.length,
    Patient: returns.filter((r) => typeOf(r).includes('Patient')).length,
    Vendor: returns.filter((r) => typeOf(r).includes('Vendor')).length,
  };

  const columns = useMemo(() => [
    {
      id: 'id', header: 'Return', accessorFn: (r) => String(r.id || ''), meta: { width: 130 },
      cell: ({ getValue }) => <span className="mono">{getValue()}</span>,
    },
    {
      id: 'date', header: 'Date', accessorFn: (r) => r.date || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span>,
    },
    {
      id: 'type', header: 'Type', accessorFn: (r) => typeOf(r), meta: { width: 150 },
      cell: ({ getValue }) => <span className={`status ${getValue().includes('Vendor') ? 'status-warning' : 'status-info'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'entity', header: 'Returned by / to', accessorFn: (r) => r.entity || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span>,
    },
    { id: 'items', header: 'Items', accessorFn: (r) => r.items || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'reason', header: 'Reason', accessorFn: (r) => r.reason || '',
      cell: ({ getValue }) => <span className="cell-secondary">{getValue() || '—'}</span>,
    },
    {
      id: 'value', header: 'Credit value', accessorFn: (r) => r.value ?? '', meta: { width: 120, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{getValue() || '—'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.status || '', meta: { width: 130 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Restocked' ? 'status-success' : 'status-warning'}`}>{getValue() || '—'}</span>,
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Returns and replacements"
          description="Patient returns that go back into stock, and vendor returns that earn a credit."
          actions={(
            <>
              <button type="button" className="btn btn-secondary btn-md" disabled title={NOT_YET}>
                <Plus size={16} aria-hidden="true" /> Vendor return
              </button>
              <button type="button" className="btn btn-primary btn-md" disabled title={NOT_YET}>
                <Plus size={16} aria-hidden="true" /> Patient return
              </button>
            </>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter by return type">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'is-active' : ''} onClick={() => setActiveTab(key)}>
                  {label} <span className="seg-count">{counts[key]}</span>
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filteredReturns}
            loading={loading}
            getRowId={(r, i) => String(r.id ?? i)}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={returns.length > 0 ? (
              <EmptyState icon={Undo2} title={`No ${activeTab.toLowerCase()} returns`} description="Choose another return type to see the rest." />
            ) : (
              <EmptyState icon={Undo2} title="No returns recorded" description="Patient and vendor returns appear here once they are logged." />
            )}
          />
        </section>
      </main>
    </>
  );
}
