import {MedicationLinks} from './MedicationUI';
import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Plus, Undo2 } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';

const TABS = [['All', 'All returns'], ['Patient', 'Patient'], ['Vendor', 'Vendor']];
const typeOf = (r) => String(r.type || '');
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const inr = (v) => `₹${Number(v || 0).toFixed(2)}`;

const KINDS = {
  patient: {
    title: 'Patient return',
    description: 'Medicines a patient brings back go back into the batch they came from.',
    type: 'patient_return',
    done: 'Patient return recorded',
  },
  vendor: {
    title: 'Vendor return',
    description: 'Stock sent back to the supplier is taken out of the batch.',
    type: 'vendor_return',
    done: 'Vendor return recorded',
  },
};
const EMPTY_FORM = { uhid: '', medicineSearch: '', medicineId: '', batchId: '', quantity: '', reason: '' };

const suggestionBox = {
  position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
};
const suggestionItem = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, borderBottom: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer',
};

export default function PharmacyReturnsPage() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');

  const [kind, setKind] = useState(null); // 'patient' | 'vendor' while the form is open
  const [form, setForm] = useState(EMPTY_FORM);
  const [suggestions, setSuggestions] = useState([]);
  const [batches, setBatches] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadReturns = () => {
    setLoading(true);
    return api.get('/pharmacist_lms/returns')
      .then(res => setReturns(res.data.data || []))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load returns');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadReturns(); }, []);

  const openForm = (k) => {
    setKind(k);
    setForm(EMPTY_FORM);
    setSuggestions([]);
    setBatches([]);
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const searchMedicine = async (value) => {
    setForm((f) => ({ ...f, medicineSearch: value, medicineId: '', batchId: '' }));
    setBatches([]);
    if (value.trim().length < 2) { setSuggestions([]); return; }
    try {
      const res = await api.get(`/medicines/search?q=${encodeURIComponent(value.trim())}`);
      setSuggestions(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const pickMedicine = async (med) => {
    setForm((f) => ({ ...f, medicineSearch: med.genericName, medicineId: med.id, batchId: '' }));
    setSuggestions([]);
    try {
      const res = await api.get(`/pharmacy/stock/batches/${med.id}`);
      setBatches(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Could not load batches for this medicine');
    }
  };

  // A patient return must match issued stock and enters quarantine; a vendor return needs stock and a supplier.
  const batchOptions = useMemo(
    () => (kind === 'vendor' ? batches.filter((b) => Number(b.QUANTITY) > 0 && b.SUPPLIER_ID) : batches),
    [batches, kind],
  );
  const selectedBatch = batchOptions.find((b) => String(b.BATCH_ID) === String(form.batchId)) || null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cfg = KINDS[kind];
    if (!form.medicineId) return toast.error('Pick the medicine from the list');
    if (!form.batchId) return toast.error('Select the batch');
    const qty = Number(form.quantity);
    if (!Number.isInteger(qty) || qty <= 0) return toast.error('Enter a whole-number quantity');
    if (kind === 'vendor' && selectedBatch && qty > Number(selectedBatch.QUANTITY)) {
      return toast.error(`Only ${selectedBatch.QUANTITY} left in batch ${selectedBatch.BATCH_NUMBER}`);
    }
    if (!form.reason.trim()) return toast.error('Enter the reason for the return');
    try {
      setSaving(true);
      await api.post('/pharmacy/return', {
        type: cfg.type,
        batchId: Number(form.batchId),
        quantity: qty,
        reason: form.reason.trim(),
        patientId: kind === 'patient' ? (form.uhid.trim() || null) : undefined,
      });
      toast.success(cfg.done);
      setKind(null);
      loadReturns();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record the return');
    } finally {
      setSaving(false);
    }
  };

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
      id: 'id', header: 'Return', accessorFn: (r) => String(r.id || ''), meta: { width: 110 },
      cell: ({ getValue }) => <span className="mono">{getValue()}</span>,
    },
    {
      id: 'date', header: 'Date', accessorFn: (r) => (r.date ? new Date(r.date).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="tabular">{fmtDate(row.original.date)}</span>,
    },
    {
      id: 'type', header: 'Type', accessorFn: (r) => typeOf(r), meta: { width: 140 },
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
      id: 'value', header: 'Value', accessorFn: (r) => Number(r.value || 0), meta: { width: 110, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{inr(getValue())}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.status || '', meta: { width: 170 },
      cell: ({ getValue }) => <span className={`status ${'status-warning'}`}>{getValue() || '—'}</span>,
    },
  ], []);

  const cfg = kind ? KINDS[kind] : null;

  return (
    <>
      <Navbar /><MedicationLinks/>
      <main className="app-page">
        <PageHeader
          title="Returns and replacements"
          description="Patient returns enter quarantine with credit handled separately. Vendor returns go back to the supplier."
          actions={(
            <>
              <button type="button" className="btn btn-secondary btn-md" onClick={() => openForm('vendor')}>
                <Plus size={16} aria-hidden="true" /> Vendor return
              </button>
              <button type="button" className="btn btn-primary btn-md" onClick={() => openForm('patient')}>
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

      <Modal
        open={Boolean(kind)}
        onOpenChange={(open) => { if (!open) setKind(null); }}
        title={cfg?.title || 'Return'}
        description={cfg?.description}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setKind(null)}>Cancel</button>
            <button type="submit" form="return-form" className="btn btn-primary btn-md" disabled={saving}>
              {saving ? 'Saving…' : 'Record return'}
            </button>
          </>
        )}
      >
        <form id="return-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          {kind === 'patient' && (
            <div className="form-group">
              <label className="form-label" htmlFor="ret-uhid">Patient UHID (optional)</label>
              <input id="ret-uhid" className="form-input" value={form.uhid} onChange={(e) => setField('uhid', e.target.value)} placeholder="e.g. HOSP-2026-000123" aria-describedby="ret-uhid-hint" />
              <p className="form-hint" id="ret-uhid-hint">Leave blank for a walk-in counter sale. Only what was issued to the patient can be returned.</p>
            </div>
          )}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label" htmlFor="ret-med">Medicine</label>
            <input id="ret-med" className="form-input" autoComplete="off" value={form.medicineSearch} onChange={(e) => searchMedicine(e.target.value)} placeholder="Search medicine" required />
            {suggestions.length > 0 && (
              <div style={suggestionBox} role="listbox" aria-label="Matching medicines">
                {suggestions.map((med) => (
                  <button key={med.id} type="button" role="option" aria-selected="false" style={suggestionItem} onClick={() => pickMedicine(med)}>
                    {med.genericName} <span className="cell-secondary">{[med.strength, med.strengthUnit].filter(Boolean).join(' ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="ret-batch">Batch</label>
              <select id="ret-batch" className="form-select" required value={form.batchId} onChange={(e) => setField('batchId', e.target.value)} disabled={!form.medicineId}>
                <option value="">{form.medicineId && batchOptions.length === 0 ? 'No batches' : 'Select batch'}</option>
                {batchOptions.map((b) => (
                  <option key={b.BATCH_ID} value={String(b.BATCH_ID)}>
                    {b.BATCH_NUMBER} (exp {fmtDate(b.EXPIRY_DATE)}, {b.QUANTITY} in stock{kind === 'vendor' && b.SUPPLIER_NAME ? `, ${b.SUPPLIER_NAME}` : ''})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="ret-qty">Quantity</label>
              <input id="ret-qty" className="form-input" type="number" min="1" step="1" required value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} />
            </div>
          </div>
          {kind === 'vendor' && selectedBatch && (
            <p className="form-hint" style={{ marginTop: -6 }}>Goes back to {selectedBatch.SUPPLIER_NAME || 'the supplier on the batch'}.</p>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="ret-reason">Reason</label>
            <textarea id="ret-reason" className="form-textarea" rows={3} required value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="For example, unopened strip returned, or damaged packaging" />
          </div>
        </form>
      </Modal>
    </>
  );
}
