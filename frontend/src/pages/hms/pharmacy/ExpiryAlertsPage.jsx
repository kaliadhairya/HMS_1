import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, RefreshCw, Search, ShieldAlert, Trash2, Undo2 } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [7, 30, 90];
const ACTIONS = {
  return: { title: 'Return to supplier', verb: 'return', confirm: 'Confirm return' },
  quarantine: { title: 'Quarantine stock', verb: 'quarantine', confirm: 'Confirm quarantine' },
  discard: { title: 'Log disposal', verb: 'dispose of', confirm: 'Confirm disposal' },
};

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const msLeft = (item) => new Date(item.EXPIRY_DATE) - new Date();
const expiryState = (item) => {
  const left = msLeft(item);
  if (left < 0) return 'expired';
  if (left <= 7 * DAY_MS) return 'critical';
  return 'soon';
};
const daysLabel = (item) => {
  const days = Math.ceil(msLeft(item) / DAY_MS);
  if (days < 0) return `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'Expires today';
  return `In ${days} ${days === 1 ? 'day' : 'days'}`;
};

export default function ExpiryAlertsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(30);
  const [query, setQuery] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionType, setActionType] = useState('return'); // return, discard, quarantine
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(0);

  useEffect(() => {
    fetchExpiring(activeTab);
  }, [activeTab]);

  const fetchExpiring = async (days) => {
    try {
      setLoading(true);
      const res = await api.get(`/pharmacy/stock/expiring?days=${days}`);
      // Quarantine status comes from the API when it provides one
      const enriched = (res.data.data || []).map(d => ({
        ...d,
        isQuarantined: Boolean(d.isQuarantined ?? d.IS_QUARANTINED),
      }));
      setData(enriched);
    } catch (err) {
      console.error(err);
      toast.error('Could not load expiry alerts');
    } finally {
      setLoading(false);
    }
  };

  const openActionModal = (batch, type) => {
    setSelectedBatch(batch);
    setActionType(type);
    setQuantity(batch.QUANTITY);
    setReason('');
    setIsModalOpen(true);
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    try {
      if (quantity <= 0 || quantity > selectedBatch.QUANTITY) {
        return toast.error('Enter a quantity between 1 and the available stock');
      }
      if (actionType === 'discard' && !reason.trim()) {
        return toast.error('Enter the disposal reason. Disposal needs a witness approval on record.');
      }

      // No API call is made for these actions yet; say so rather than confirming a change that was not saved.
      toast(`${ACTIONS[actionType].title} noted, but not saved. This screen is not yet connected to stock records.`, { duration: 6000 });
      setIsModalOpen(false);
      fetchExpiring(activeTab);
    } catch (err) {
      console.error(err);
      toast.error(`Could not ${ACTIONS[actionType].verb} this stock`);
    }
  };

  const counts = useMemo(() => ({
    expired: data.filter((d) => expiryState(d) === 'expired').length,
    critical: data.filter((d) => expiryState(d) === 'critical').length,
    units: data.reduce((sum, d) => sum + Number(d.QUANTITY || 0), 0),
  }), [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((d) => [d.GENERIC_NAME, d.BATCH_NUMBER, d.SUPPLIER_NAME].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [data, query]);

  const columns = useMemo(() => [
    {
      id: 'medicine', header: 'Medicine', accessorFn: (d) => d.GENERIC_NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.GENERIC_NAME}</span>
          <span className="cell-secondary">{[row.original.FORMULATION, row.original.STRENGTH].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    },
    {
      id: 'batch', header: 'Batch', accessorFn: (d) => d.BATCH_NUMBER || '', meta: { width: 150 },
      cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span>,
    },
    {
      id: 'expiry', header: 'Expires', accessorFn: (d) => new Date(d.EXPIRY_DATE).getTime() || 0, meta: { width: 180 },
      cell: ({ row }) => {
        const state = expiryState(row.original);
        return (
          <span className="cell-stack">
            <span className="tabular" style={{ fontWeight: state === 'soon' ? undefined : 600, color: state === 'soon' ? undefined : 'var(--red)' }}>{fmtDate(row.original.EXPIRY_DATE)}</span>
            <span className="cell-secondary">{daysLabel(row.original)}</span>
          </span>
        );
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (d) => ({ expired: 0, critical: 1, soon: 2 }[expiryState(d)]), meta: { width: 210 },
      cell: ({ row }) => {
        const state = expiryState(row.original);
        return (
          <span className="chip-row" style={{ gap: 4 }}>
            {state === 'expired' && <span className="status status-danger">Expired</span>}
            {state === 'critical' && <span className="status status-warning">Within 7 days</span>}
            {state === 'soon' && <span className="status status-info">Expiring soon</span>}
            {row.original.isQuarantined && <span className="status status-neutral">Quarantined</span>}
          </span>
        );
      },
    },
    {
      id: 'qty', header: 'Qty', accessorFn: (d) => Number(d.QUANTITY || 0), meta: { width: 90, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{getValue()}</span>,
    },
    { id: 'supplier', header: 'Supplier', accessorFn: (d) => d.SUPPLIER_NAME || '', meta: { width: 180 }, cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => (
        <RowMenu
          label={`Actions for ${row.original.GENERIC_NAME} batch ${row.original.BATCH_NUMBER}`}
          items={[
            { label: 'Return to supplier', icon: Undo2, onSelect: () => openActionModal(row.original, 'return') },
            { label: 'Quarantine', icon: ShieldAlert, onSelect: () => openActionModal(row.original, 'quarantine') },
            { label: 'Log disposal', icon: Trash2, onSelect: () => openActionModal(row.original, 'discard'), danger: true, separator: true },
          ]}
        />
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const action = ACTIONS[actionType] || ACTIONS.return;

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Expiry alerts"
          description="Batches that have expired or expire soon. Quarantine them, return them to the supplier, or log their disposal."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => fetchExpiring(activeTab)}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi">
            <div className="kpi-label">Expired</div>
            <div className="kpi-value" style={{ color: counts.expired > 0 ? 'var(--red)' : undefined }}>{loading ? '—' : counts.expired}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Expire within 7 days</div>
            <div className="kpi-value" style={{ color: counts.critical > 0 ? 'var(--amber)' : undefined }}>{loading ? '—' : counts.critical}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Batches in the next {activeTab} days</div>
            <div className="kpi-value">{loading ? '—' : data.length}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Units affected</div>
            <div className="kpi-value">{loading ? '—' : counts.units.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Expiry window">
              {WINDOWS.map((days) => (
                <button key={days} type="button" role="tab" aria-selected={activeTab === days} className={activeTab === days ? 'is-active' : ''} onClick={() => setActiveTab(days)}>
                  {days} days
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search expiring batches</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search medicine, batch or supplier" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(d) => String(d.BATCH_ID)}
            initialSorting={[{ id: 'expiry', desc: false }]}
            empty={data.length > 0 ? (
              <EmptyState icon={Search} title="No batches match" description="Try another medicine, batch number or supplier." />
            ) : (
              <EmptyState icon={CalendarClock} title={`Nothing expires within ${activeTab} days`} description="Choose a longer window to look further ahead." />
            )}
          />
        </section>
      </main>

      <Modal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        title={action.title}
        description={selectedBatch ? `${selectedBatch.GENERIC_NAME} · batch ${selectedBatch.BATCH_NUMBER}` : ''}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" form="expiry-action-form" className={`btn btn-md ${actionType === 'discard' ? 'btn-danger' : 'btn-primary'}`}>
              {action.confirm}
            </button>
          </>
        )}
      >
        <form id="expiry-action-form" onSubmit={handleActionSubmit} style={{ display: 'grid', gap: 14 }}>
          <div className="facts">
            <div><div className="fact-label">Batch</div><div className="fact-value mono">{selectedBatch?.BATCH_NUMBER || '—'}</div></div>
            <div><div className="fact-label">Expires</div><div className="fact-value tabular">{fmtDate(selectedBatch?.EXPIRY_DATE)}</div></div>
            <div><div className="fact-label">Available</div><div className="fact-value tabular">{selectedBatch?.QUANTITY ?? '—'}</div></div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="expiry-qty">Quantity to {action.verb}</label>
            <input
              id="expiry-qty" className="form-input" required type="number" min="1" max={selectedBatch?.QUANTITY}
              value={quantity} onChange={e => setQuantity(e.target.value)}
            />
          </div>

          {(actionType === 'discard' || actionType === 'quarantine') && (
            <div className="form-group">
              <label className="form-label" htmlFor="expiry-reason">Reason</label>
              <textarea
                id="expiry-reason" className="form-textarea" required rows="3"
                placeholder="Give the reason for the audit trail"
                value={reason} onChange={e => setReason(e.target.value)}
              />
            </div>
          )}

          {actionType === 'discard' && (
            <div className="alert-strip alert-danger" role="note" style={{ marginBottom: 0 }}>
              Disposal needs witness approval under compliance rules and must be entered in the destruction register.
            </div>
          )}
          <p className="form-hint">This action is not yet saved to stock records from this screen.</p>
        </form>
      </Modal>
    </>
  );
}
