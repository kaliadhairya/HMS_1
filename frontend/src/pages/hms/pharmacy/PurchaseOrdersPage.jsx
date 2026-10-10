import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ClipboardList, PackageCheck, Plus, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const STATUS_TONE = { Delivered: 'success', 'Pending Approval': 'warning' };

// The API sends the value pre-formatted (e.g. "1,250" or "1250.00"); show it as rupees when it parses.
const money = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : String(v ?? '—');
};
const toNumber = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    // keeping endpoint same as requested, but we map the UI to PR
    api.get('/pharmacist_lms/purchase-orders')
      .then(res => setPos(res.data.data || []))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load purchase requests');
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter((po) => [po.id, po.supplier, po.status].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [pos, query]);

  const openCount = pos.filter((po) => po.status !== 'Delivered').length;

  const columns = useMemo(() => [
    {
      id: 'id', header: 'PR number', accessorFn: (po) => String(po.id || ''), meta: { width: 150 },
      cell: ({ getValue }) => <span className="mono">{getValue()}</span>,
    },
    {
      id: 'date', header: 'Raised on', accessorFn: (po) => po.date || '', meta: { width: 130 },
      cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span>,
    },
    {
      id: 'supplier', header: 'Supplier', accessorFn: (po) => po.supplier || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span>,
    },
    {
      id: 'value', header: 'Value', accessorFn: (po) => toNumber(po.value), meta: { width: 130, align: 'right' },
      cell: ({ row }) => <span className="tabular">{money(row.original.value)}</span>,
    },
    {
      id: 'expected', header: 'Expected delivery', accessorFn: (po) => po.expectedDelivery || '', meta: { width: 160 },
      cell: ({ getValue }) => <span className="tabular cell-secondary">{getValue() || '—'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (po) => po.status || '', meta: { width: 160 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'info'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 140, align: 'right' },
      cell: ({ row }) => (row.original.status !== 'Delivered' ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/pharmacy/grn')}>
          <PackageCheck size={14} aria-hidden="true" /> Record GRN
        </button>
      ) : null),
    },
  ], [navigate]);

  const raiseButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/pharmacy/raise-indent')}>
      <Plus size={16} aria-hidden="true" /> Raise indent
    </button>
  );

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Purchase requests"
          description="Indents raised to suppliers, their approval status, and the link to goods receipt."
          meta={!loading && <span className="muted">{pos.length} requests · {openCount} awaiting delivery</span>}
          actions={raiseButton}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search purchase requests</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PR number, supplier or status" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(po) => String(po.id)}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={pos.length > 0 ? (
              <EmptyState icon={Search} title="No requests match" description="Try another PR number or supplier name." />
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="No purchase requests yet"
                description="Raise an indent to request stock from a supplier."
                action={raiseButton}
              />
            )}
          />
        </section>
      </main>
    </>
  );
}
